-- =========================================================
-- RhiPower — Invoices
-- =========================================================
-- Phase 3 of the ERP build-out: real tax-itemized invoices generated from a
-- Sales Order, working toward replacing Zoho Invoice.
--
-- VAT is itemized starting HERE, not retrofitted onto quotes/Sales Orders —
-- those stay VAT-inclusive as a single headline number (matching the
-- existing customer-facing proposal PDF's "Prices inclusive of 16% VAT"
-- convention), so existing/pending customers never see a price change.
-- subtotal_kes is derived by backing 16% out of the Sales Order's total,
-- not added on top.
--
-- invoice_lines is a deliberately SUMMARIZED view of a Sales Order's ~20
-- granular BOM rows — grouped into ~5 lines (one per zone + labour +
-- logistics) by generateInvoiceFromSalesOrder() in lib/invoices.js — so a
-- customer sees a readable invoice, not an itemized fastener count.
-- =========================================================

CREATE TABLE IF NOT EXISTS invoices (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  invoice_number   INTEGER     GENERATED ALWAYS AS IDENTITY (START WITH 1),  -- display as INV-{year}-{padded}
  sales_order_id   UUID        NOT NULL REFERENCES sales_orders(id) ON DELETE RESTRICT,
  customer_user_id UUID        REFERENCES customer_profiles(id) ON DELETE SET NULL,
  client_name      TEXT        NOT NULL,
  client_phone     TEXT        NOT NULL,
  client_email     TEXT,
  site_address     TEXT,
  issue_date       DATE        NOT NULL DEFAULT CURRENT_DATE,
  due_date         DATE,
  status           TEXT        NOT NULL DEFAULT 'draft',
  -- 'draft' | 'sent' | 'partially_paid' | 'paid' | 'overdue' | 'void'
  -- 'overdue' is set explicitly when detected (see isOverdue() display helper
  -- for the live check) — there's no cron in this backend-less app to flip it
  -- automatically, so the UI treats "sent/partially_paid + past due_date" as
  -- overdue for display without requiring the stored status to change.
  subtotal_kes     NUMERIC(12,2) NOT NULL DEFAULT 0,  -- pre-VAT
  vat_rate_pct     NUMERIC(5,2)  NOT NULL DEFAULT 16,
  vat_kes          NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_kes        NUMERIC(12,2) NOT NULL DEFAULT 0,  -- subtotal + vat
  amount_paid_kes  NUMERIC(12,2) NOT NULL DEFAULT 0,  -- denormalised sum of payments, kept in sync by lib/payments.js
  balance_due_kes  NUMERIC(12,2) GENERATED ALWAYS AS (total_kes - amount_paid_kes) STORED,
  notes            TEXT,
  admin_id         UUID        REFERENCES admin_profiles(id) ON DELETE SET NULL,
  admin_email      TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoices_so     ON invoices(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id     UUID        NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description    TEXT        NOT NULL,
  qty            NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price_kes NUMERIC(12,2) NOT NULL,  -- pre-VAT unit price
  line_total_kes NUMERIC(12,2) GENERATED ALWAYS AS (qty * unit_price_kes) STORED,
  sort_order     INTEGER     NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines(invoice_id);

ALTER TABLE invoices      ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_can_manage_invoices"
  ON invoices FOR ALL TO authenticated
  USING     (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

CREATE POLICY "admin_can_manage_invoice_lines"
  ON invoice_lines FOR ALL TO authenticated
  USING     (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

CREATE POLICY "customer_can_read_own_invoices"
  ON invoices FOR SELECT TO authenticated
  USING (customer_user_id = auth.uid());

CREATE POLICY "customer_can_read_own_invoice_lines"
  ON invoice_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_lines.invoice_id AND i.customer_user_id = auth.uid()));

-- ─── DONE ────────────────────────────────────────────────────────────────────
-- After running: a "Generate Invoice" button appears on any confirmed (or
-- later) Sales Order, and a new "Invoices" section appears in the admin
-- sidebar with a VAT-itemized invoice, PDF export, and payment tracking.

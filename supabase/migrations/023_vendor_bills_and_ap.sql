-- =========================================================
-- RhiPower — Accounts Payable / Vendor Bills (Accounting Module, Phase 3)
-- =========================================================
-- No AP concept exists anywhere in this schema today — a Purchase Order is
-- a procurement document only (what was ordered, what's been received), not
-- a payable. This adds a real Bill/AP layer that PO receiving posts against
-- automatically (see src/lib/vendorBills.js), plus the ability to bill a
-- non-inventory operating expense (fuel, rent, subscriptions) that never
-- goes through a PO at all — a solar SME's real expense base isn't just
-- inventory, so both paths need to exist for "no stone unturned" to be true.
--
-- Mirrors the existing invoices/invoice_lines/payments shape closely on
-- purpose: vendor_bills ~ invoices, vendor_bill_lines ~ invoice_lines,
-- supplier_payments ~ payments. Same append-only philosophy — no payment
-- ever gets edited or deleted after the fact.
-- =========================================================

CREATE TABLE IF NOT EXISTS vendor_bills (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  bill_number       INTEGER     GENERATED ALWAYS AS IDENTITY (START WITH 1),  -- display as BILL-0001
  supplier_id       UUID        NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  purchase_order_id UUID        REFERENCES purchase_orders(id) ON DELETE SET NULL,  -- NULL for a non-PO operating-expense bill
  bill_reference    TEXT,       -- the supplier's own invoice/receipt number
  bill_date         DATE        NOT NULL DEFAULT CURRENT_DATE,
  due_date          DATE,
  status            TEXT        NOT NULL DEFAULT 'unpaid' CHECK (status IN ('draft','unpaid','partially_paid','paid','void')),
  subtotal_kes      NUMERIC(12,2) NOT NULL DEFAULT 0,
  vat_kes           NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_kes         NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount_paid_kes   NUMERIC(12,2) NOT NULL DEFAULT 0,  -- kept in sync by lib/supplierPayments.js, same pattern as invoices.amount_paid_kes
  balance_due_kes   NUMERIC(12,2) GENERATED ALWAYS AS (total_kes - amount_paid_kes) STORED,
  notes             TEXT,
  admin_id          UUID        REFERENCES admin_profiles(id) ON DELETE SET NULL,
  admin_email       TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vb_number   ON vendor_bills(bill_number);
CREATE INDEX IF NOT EXISTS idx_vb_supplier ON vendor_bills(supplier_id);
CREATE INDEX IF NOT EXISTS idx_vb_po       ON vendor_bills(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_vb_status   ON vendor_bills(status);

CREATE TABLE IF NOT EXISTS vendor_bill_lines (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendor_bill_id UUID        NOT NULL REFERENCES vendor_bills(id) ON DELETE CASCADE,
  line_type      TEXT        NOT NULL CHECK (line_type IN ('inventory','expense')),
  role_key       TEXT        REFERENCES inventory_prices(role_key) ON DELETE RESTRICT,   -- required iff line_type='inventory'
  account_id     UUID        REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,        -- required iff line_type='expense'
  description    TEXT        NOT NULL,
  qty            NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_cost_kes  NUMERIC(12,2) NOT NULL,   -- always pre-tax — a supplier's quoted cost is treated as
                                            -- exclusive of VAT here regardless of org_settings.vat_pricing_mode,
                                            -- which only governs SELL-side invoice math
  vat_status     TEXT        NOT NULL DEFAULT 'standard' CHECK (vat_status IN ('standard','zero_rated','exempt')),
  vat_amount_kes NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total_kes NUMERIC(12,2) GENERATED ALWAYS AS (qty * unit_cost_kes) STORED,
  CHECK ((line_type = 'inventory' AND role_key IS NOT NULL AND account_id IS NULL)
      OR (line_type = 'expense'   AND account_id IS NOT NULL AND role_key IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_vbl_bill ON vendor_bill_lines(vendor_bill_id);

CREATE TABLE IF NOT EXISTS supplier_payments (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  vendor_bill_id UUID        NOT NULL REFERENCES vendor_bills(id) ON DELETE RESTRICT,
  amount_kes     NUMERIC(12,2) NOT NULL CHECK (amount_kes > 0),
  method         TEXT        NOT NULL DEFAULT 'bank_transfer' CHECK (method IN ('mpesa','bank_transfer','cash','cheque')),
  reference      TEXT,
  paid_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  admin_id       UUID        REFERENCES admin_profiles(id) ON DELETE SET NULL,
  admin_email    TEXT,
  notes          TEXT
);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_bill ON supplier_payments(vendor_bill_id);

ALTER TABLE vendor_bills       ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_bill_lines  ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_payments  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_can_manage_vendor_bills"       ON vendor_bills       FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));
CREATE POLICY "admin_can_manage_vendor_bill_lines"  ON vendor_bill_lines  FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));
CREATE POLICY "admin_can_manage_supplier_payments"  ON supplier_payments  FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- ─── DONE ────────────────────────────────────────────────────────────────────
-- After running: receiving stock against a Purchase Order (AdminPurchaseOrders.jsx)
-- automatically creates/updates a Bill and posts Dr Inventory Asset + Dr Input
-- VAT Receivable / Cr Accounts Payable. The new "🧾 Vendor Bills" admin section
-- lets you also bill any non-PO operating expense and record supplier payments.

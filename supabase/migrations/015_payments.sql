-- =========================================================
-- RhiPower — Payments
-- =========================================================
-- The last piece of the invoicing loop: a real payment ledger against an
-- invoice, extending beyond the existing M-Pesa-booking-deposit-only
-- deposit_transactions table (which stays exactly as-is — it still handles
-- the pre-invoice booking deposit STK push).
--
-- deposit_txn_id links a completed booking deposit to the invoice it
-- eventually gets applied against — generateInvoiceFromSalesOrder() in
-- lib/invoices.js auto-credits an existing completed deposit onto a new
-- invoice the moment it's created, so a customer who already paid a
-- deposit sees it reflected immediately rather than a $0-paid invoice.
-- =========================================================

CREATE TABLE IF NOT EXISTS payments (
  id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  invoice_id          UUID        NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  amount_kes          NUMERIC(12,2) NOT NULL CHECK (amount_kes > 0),
  method              TEXT        NOT NULL DEFAULT 'mpesa',  -- 'mpesa' | 'bank_transfer' | 'cash' | 'cheque'
  reference           TEXT,        -- mpesa_receipt, bank ref, cheque no., free text
  paid_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deposit_txn_id      UUID        REFERENCES deposit_transactions(id) ON DELETE SET NULL,
  admin_id            UUID        REFERENCES admin_profiles(id) ON DELETE SET NULL,
  admin_email         TEXT,
  notes               TEXT
);

CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_can_manage_payments"
  ON payments FOR ALL TO authenticated
  USING     (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

CREATE POLICY "customer_can_read_own_payments"
  ON payments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM invoices i WHERE i.id = payments.invoice_id AND i.customer_user_id = auth.uid()));

-- ─── DONE ────────────────────────────────────────────────────────────────────
-- After running: the Invoices admin panel gains a "Record Payment" action
-- (cash/bank transfer/cheque/M-Pesa reference) that updates the invoice's
-- amount_paid_kes and status (sent → partially_paid → paid) automatically.

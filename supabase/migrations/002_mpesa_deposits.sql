-- =========================================================
-- RhiPower — M-Pesa Deposit Collection
-- =========================================================
-- Lets a client pay a booking deposit via Safaricom Daraja STK Push
-- to secure their quote. Run this in the Supabase SQL Editor after
-- schema.sql has already been applied.
-- =========================================================

CREATE TABLE IF NOT EXISTS deposit_transactions (
  id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),

  quotation_id        UUID        REFERENCES quotation_requests(id) ON DELETE SET NULL,

  phone               TEXT        NOT NULL,   -- normalised 2547XXXXXXXX
  amount_kes          NUMERIC(12,2) NOT NULL,

  -- Safaricom identifiers
  checkout_request_id TEXT        NOT NULL UNIQUE,
  merchant_request_id TEXT,

  -- 'pending' → 'completed' | 'failed' | 'needs_review'
  -- 'needs_review' = callback and the independent STK status query disagreed — check manually
  status              TEXT        NOT NULL DEFAULT 'pending',
  mpesa_receipt        TEXT,
  result_desc          TEXT
);

CREATE INDEX IF NOT EXISTS idx_deposit_checkout  ON deposit_transactions(checkout_request_id);
CREATE INDEX IF NOT EXISTS idx_deposit_quotation ON deposit_transactions(quotation_id);
CREATE INDEX IF NOT EXISTS idx_deposit_status    ON deposit_transactions(status);

ALTER TABLE deposit_transactions ENABLE ROW LEVEL SECURITY;

-- No anon policy at all, by design: clients never query this table directly.
-- The mpesa-stk-push / mpesa-status Edge Functions use the service-role key
-- (which bypasses RLS) to insert/read on the client's behalf, so a client can
-- only ever see the one transaction they just started, never browse the table.

-- Admins can see every deposit from the dashboard
CREATE POLICY "auth_can_read_deposits"
  ON deposit_transactions FOR SELECT TO authenticated
  USING (true);

-- ─── DONE ────────────────────────────────────────────────────────────────────

-- =========================================================
-- RhiPower — Bank Accounts + Reconciliation (Accounting Module, Phase 4)
-- =========================================================
-- bank_accounts is a thin wrapper around the three cash/bank/mpesa system
-- accounts already seeded in migration 021 (chart_of_accounts.system_key
-- 'petty_cash'/'bank_operating'/'mpesa_till') — one row per account the
-- admin actually reconciles against a real statement, linked 1:1 to its GL
-- account. bank_reconciliations tracks each reconciliation session; a
-- "cleared" flag on journal_entry_lines marks which postings have been
-- matched against a statement — a status flag, not a financial-field edit,
-- so it doesn't violate the ledger's append-only/immutable-amounts rule.
-- =========================================================

CREATE TABLE IF NOT EXISTS bank_accounts (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  account_id     UUID        NOT NULL UNIQUE REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  account_name   TEXT        NOT NULL,
  account_type   TEXT        NOT NULL CHECK (account_type IN ('bank','mpesa','cash')),
  bank_name      TEXT,
  account_number TEXT,
  is_active      BOOLEAN     NOT NULL DEFAULT true
);

INSERT INTO bank_accounts (account_id, account_name, account_type)
SELECT id, name, CASE system_key WHEN 'mpesa_till' THEN 'mpesa' WHEN 'petty_cash' THEN 'cash' ELSE 'bank' END
FROM chart_of_accounts WHERE system_key IN ('petty_cash', 'bank_operating', 'mpesa_till')
ON CONFLICT (account_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS bank_reconciliations (
  id                            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at                    TIMESTAMPTZ DEFAULT NOW(),
  bank_account_id               UUID        NOT NULL REFERENCES bank_accounts(id) ON DELETE RESTRICT,
  statement_date                DATE        NOT NULL,
  statement_ending_balance_kes  NUMERIC(12,2) NOT NULL,
  book_balance_kes              NUMERIC(12,2) NOT NULL,   -- GL balance snapshotted when the reconciliation started, for reference
  status                        TEXT        NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
  completed_at                  TIMESTAMPTZ,
  admin_id                      UUID        REFERENCES admin_profiles(id) ON DELETE SET NULL,
  admin_email                   TEXT,
  notes                         TEXT
);
CREATE INDEX IF NOT EXISTS idx_bank_recon_account ON bank_reconciliations(bank_account_id);

ALTER TABLE journal_entry_lines ADD COLUMN IF NOT EXISTS cleared BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE journal_entry_lines ADD COLUMN IF NOT EXISTS reconciliation_id UUID REFERENCES bank_reconciliations(id) ON DELETE SET NULL;

ALTER TABLE bank_accounts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_reconciliations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_can_manage_bank_accounts"        ON bank_accounts        FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));
CREATE POLICY "admin_can_manage_bank_reconciliations" ON bank_reconciliations FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- ─── DONE ────────────────────────────────────────────────────────────────────
-- After running: the new "🏦 Bank & Reconciliation" tab in Accounting lets
-- you reconcile Petty Cash / Bank Account / M-Pesa Till against a real
-- statement — check off ledger lines until the running total matches the
-- statement's ending balance.

-- =========================================================
-- RhiPower — Chart of Accounts + General Ledger (Accounting Module, Phase 1)
-- =========================================================
-- Everything financial in this app so far (invoices, payments, stock
-- valuation, gross margin) is computed ad hoc from operational tables —
-- there is no ledger. This adds a real double-entry core underneath it:
-- a Chart of Accounts, and journal_entries/journal_entry_lines that will
-- (from Phase 2 onward) get posted automatically from the existing
-- invoice/payment/sales-order-confirm code paths, plus a manual-entry UI
-- for anything that doesn't come from those flows (owner capital, loan
-- proceeds, ad-hoc adjustments).
--
-- Journal entries are immutable and append-only, same philosophy as
-- `payments` — corrections only ever happen via a reversing entry
-- (src/lib/ledger.js's reverseJournalEntry()), never by editing a posted
-- line. Application code enforces the double-entry balance check before
-- ever inserting (this codebase has no DB triggers anywhere except the
-- one auth.users->customer_profiles signup mirror from migration 003) —
-- but given the stakes of a financial ledger, this migration adds ONE
-- narrowly-scoped exception: a deferred CONSTRAINT TRIGGER on
-- journal_entry_lines that rejects any change leaving an entry unbalanced.
-- This is a safety net against a future direct SQL-editor edit bypassing
-- src/lib/ledger.js — not a replacement for the app-layer check, which
-- still runs first and produces a much friendlier error message.
-- =========================================================

-- ─── 1. Chart of Accounts ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  code             TEXT        NOT NULL UNIQUE,
  name             TEXT        NOT NULL,
  account_type     TEXT        NOT NULL CHECK (account_type IN ('asset','liability','equity','income','expense')),
  account_subtype  TEXT        NOT NULL CHECK (account_subtype IN (
                     'current_asset','fixed_asset','contra_asset',
                     'current_liability',
                     'equity','contra_equity',
                     'income',
                     'cogs','operating_expense','other_expense'
                   )),
  normal_balance   TEXT        NOT NULL CHECK (normal_balance IN ('debit','credit')),
  -- Stable programmatic handle the posting engine reads by (e.g.
  -- 'accounts_receivable') — NEVER the mutable code/name — so the admin can
  -- rename/renumber an account in the UI without breaking auto-posting.
  -- NULL for admin-added accounts that nothing in app code posts to directly.
  system_key       TEXT        UNIQUE,
  parent_id        UUID        REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  -- is_system accounts are required by the posting engine — the UI (not
  -- RLS, which stays a plain admin-write policy like everything else)
  -- blocks delete/deactivate on these, only renaming code/name/description
  -- is allowed.
  is_system        BOOLEAN     NOT NULL DEFAULT false,
  is_active        BOOLEAN     NOT NULL DEFAULT true,
  description      TEXT
);

CREATE INDEX IF NOT EXISTS idx_coa_type   ON chart_of_accounts(account_type);
CREATE INDEX IF NOT EXISTS idx_coa_active ON chart_of_accounts(is_active);

-- ─── 2. Journal entries (header) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS journal_entries (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  entry_number   INTEGER     GENERATED ALWAYS AS IDENTITY (START WITH 1),  -- display as JE-0001
  entry_date     DATE        NOT NULL DEFAULT CURRENT_DATE,   -- accounting date; can differ from created_at (opening balances, backdated corrections)
  memo           TEXT        NOT NULL,
  source_type    TEXT,       -- 'invoice' | 'payment' | 'sales_order_confirm' | 'purchase_order_receipt' |
                              -- 'vendor_bill' | 'supplier_payment' | 'fixed_asset' | 'depreciation' |
                              -- 'opening_balance' | 'manual' | NULL for a reversal (see is_reversal_of)
  source_id      UUID,       -- polymorphic, unenforced FK — same convention as stock_movements.source_id (migration 012)
  is_reversal_of UUID        REFERENCES journal_entries(id) ON DELETE SET NULL,
  reversed_by    UUID        REFERENCES journal_entries(id) ON DELETE SET NULL,
  status         TEXT        NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','void')),
  -- 'void' is only ever set once a reversal targeting this entry is posted — never by editing lines.
  admin_id       UUID        REFERENCES admin_profiles(id) ON DELETE SET NULL,
  admin_email    TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_je_number ON journal_entries(entry_number);
CREATE INDEX IF NOT EXISTS idx_je_source ON journal_entries(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_je_date   ON journal_entries(entry_date);

-- ─── 3. Journal entry lines ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS journal_entry_lines (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  journal_entry_id UUID        NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id       UUID        NOT NULL REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  debit_kes        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (debit_kes >= 0),
  credit_kes       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (credit_kes >= 0),
  description      TEXT,
  CHECK ((debit_kes > 0 AND credit_kes = 0) OR (credit_kes > 0 AND debit_kes = 0))
);

CREATE INDEX IF NOT EXISTS idx_jel_je      ON journal_entry_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_jel_account ON journal_entry_lines(account_id);

-- ─── 4. Period locking ──────────────────────────────────────────────────────
-- Append-only log of "closed through" events — an "unlock" sets reopened_at
-- on the existing row rather than deleting it, matching this codebase's
-- audit-trail-over-mutation habit (see admin_audit_log).
CREATE TABLE IF NOT EXISTS accounting_periods (
  id                 UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  period_end         DATE        NOT NULL,     -- books locked THROUGH this date, inclusive
  locked_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_by_email    TEXT,
  reopened_at        TIMESTAMPTZ,
  reopened_by_email  TEXT,
  notes              TEXT
);
CREATE INDEX IF NOT EXISTS idx_periods_end ON accounting_periods(period_end);

-- ─── 5. RLS — admin-only everywhere, nothing customer-facing in this module ─
ALTER TABLE chart_of_accounts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries     ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entry_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_periods  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_can_manage_coa"             ON chart_of_accounts   FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));
CREATE POLICY "admin_can_manage_journal_entries" ON journal_entries     FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));
CREATE POLICY "admin_can_manage_journal_lines"   ON journal_entry_lines FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));
CREATE POLICY "admin_can_manage_periods"         ON accounting_periods  FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- ─── 6. Safety-net trigger — the one deliberate exception to "no DB triggers" ─
-- Fires once per statement (DEFERRABLE INITIALLY DEFERRED), after every
-- insert/update/delete on journal_entry_lines, checking that the affected
-- entry's lines still sum to zero net (debits = credits). The app's own
-- postJournalEntry() already enforces this with a friendlier error before
-- ever reaching the DB — this is only a backstop against a future direct
-- SQL-editor edit slipping an unbalanced change past the application layer.
CREATE OR REPLACE FUNCTION check_journal_entry_balanced() RETURNS TRIGGER AS $$
DECLARE
  v_je_id  UUID;
  v_debit  NUMERIC;
  v_credit NUMERIC;
BEGIN
  v_je_id := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);
  SELECT COALESCE(SUM(debit_kes), 0), COALESCE(SUM(credit_kes), 0)
    INTO v_debit, v_credit
    FROM journal_entry_lines WHERE journal_entry_id = v_je_id;
  IF ROUND(v_debit, 2) <> ROUND(v_credit, 2) THEN
    RAISE EXCEPTION 'Journal entry % is unbalanced: debits=% credits=%', v_je_id, v_debit, v_credit;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_entry_lines_balanced ON journal_entry_lines;
CREATE CONSTRAINT TRIGGER trg_journal_entry_lines_balanced
  AFTER INSERT OR UPDATE OR DELETE ON journal_entry_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_journal_entry_balanced();

-- ─── 7. Default Chart of Accounts — seeded for a solar-installation Kenyan SME ─
INSERT INTO chart_of_accounts (code, name, account_type, account_subtype, normal_balance, system_key, is_system) VALUES
  ('1000', 'Petty Cash',                                   'asset',     'current_asset',     'debit',  'petty_cash',              true),
  ('1010', 'Bank Account',                                 'asset',     'current_asset',     'debit',  'bank_operating',          true),
  ('1020', 'M-Pesa Till',                                  'asset',     'current_asset',     'debit',  'mpesa_till',              true),
  ('1100', 'Accounts Receivable',                          'asset',     'current_asset',     'debit',  'accounts_receivable',    true),
  ('1200', 'Inventory Asset',                              'asset',     'current_asset',     'debit',  'inventory_asset',        true),
  ('1300', 'Input VAT Receivable',                         'asset',     'current_asset',     'debit',  'input_vat',               true),
  ('1400', 'Fixed Assets — Vehicles',                      'asset',     'fixed_asset',        'debit',  'fixed_assets_vehicles',  true),
  ('1410', 'Fixed Assets — Tools & Equipment',              'asset',     'fixed_asset',        'debit',  'fixed_assets_tools',     true),
  ('1420', 'Accumulated Depreciation — Vehicles',           'asset',     'contra_asset',       'credit', 'accum_depr_vehicles',    true),
  ('1430', 'Accumulated Depreciation — Tools & Equipment',  'asset',     'contra_asset',       'credit', 'accum_depr_tools',       true),
  ('2000', 'Accounts Payable',                             'liability', 'current_liability',  'credit', 'accounts_payable',       true),
  ('2100', 'Output VAT Payable',                           'liability', 'current_liability',  'credit', 'output_vat',             true),
  ('3000', 'Owner''s Capital',                             'equity',    'equity',             'credit', 'owners_capital',         true),
  ('3100', 'Owner''s Drawings',                            'equity',    'contra_equity',      'debit',  'owners_drawings',        true),
  ('4000', 'Sales Revenue — Materials',                    'income',    'income',             'credit', 'sales_revenue_materials',true),
  ('4100', 'Sales Revenue — Labour',                       'income',    'income',             'credit', 'sales_revenue_labour',   true),
  ('4200', 'Sales Revenue — Logistics',                    'income',    'income',             'credit', 'sales_revenue_logistics',true),
  ('4900', 'Other Income',                                 'income',    'income',             'credit', 'other_income',           false),
  ('5000', 'Cost of Goods Sold',                           'expense',   'cogs',               'debit',  'cogs',                   true),
  ('6010', 'Rent Expense',                                 'expense',   'operating_expense',  'debit',  NULL,                     false),
  ('6020', 'Utilities Expense',                            'expense',   'operating_expense',  'debit',  NULL,                     false),
  ('6030', 'Fuel & Transport Expense',                     'expense',   'operating_expense',  'debit',  NULL,                     false),
  ('6040', 'Airtime & Communication Expense',               'expense',   'operating_expense',  'debit',  NULL,                     false),
  ('6050', 'Bank Charges & Fees',                          'expense',   'operating_expense',  'debit',  'bank_charges',           false),
  ('6060', 'Professional Fees Expense',                    'expense',   'operating_expense',  'debit',  NULL,                     false),
  ('6070', 'Office Supplies Expense',                      'expense',   'operating_expense',  'debit',  NULL,                     false),
  ('6080', 'Repairs & Maintenance Expense',                'expense',   'operating_expense',  'debit',  NULL,                     false),
  ('6090', 'Depreciation Expense',                         'expense',   'operating_expense',  'debit',  'depreciation_expense',   true),
  ('6100', 'Gain/Loss on Asset Disposal',                  'expense',   'other_expense',      'debit',  'disposal_gain_loss',     true),
  ('6900', 'Miscellaneous Expense',                        'expense',   'operating_expense',  'debit',  NULL,                     false)
ON CONFLICT (code) DO NOTHING;

-- ─── DONE ────────────────────────────────────────────────────────────────────
-- After running: the new "📚 Accounting" section in the admin sidebar lets you
-- manage the Chart of Accounts and post manual journal entries. Nothing in
-- the rest of the app auto-posts yet (that's Phase 2) — this migration is
-- purely additive and carries zero risk to any existing flow.

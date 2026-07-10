-- =========================================================
-- RhiPower — Proper multi-step Income Statement (Operating vs Non-Operating)
-- =========================================================
-- Researched income-statement best practice: a "multi-step" format —
-- Revenue, COGS, Gross Profit, Operating Expenses, Operating Income, then a
-- separate Non-Operating (Other) Income/Expense section, then Net Profit —
-- is what's expected by anyone reviewing the business seriously (investors,
-- lenders), vs. a flat single-step P&L that dumps everything together.
--
-- The Chart of Accounts (migration 021) already distinguishes
-- 'operating_expense' from 'other_expense' on the expense side (e.g. code
-- 6100 "Gain/Loss on Asset Disposal" is other_expense) — but the income
-- side has no equivalent: every income account, including 4900 "Other
-- Income", shares the single subtype 'income'. That's why
-- getProfitAndLoss() has been lumping Other Income in with real sales
-- revenue, and lumping the one-off asset-disposal loss in with recurring
-- rent/fuel/utilities as if it were an ordinary operating cost.
--
-- This widens the account_subtype CHECK to add 'other_income' (mirroring
-- 'other_expense') and retags the existing Other Income account. Finding
-- the existing constraint by querying pg_constraint rather than assuming
-- its auto-generated name, since that's not guaranteed across Postgres
-- versions/setups.
-- =========================================================

DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  SELECT con.conname INTO v_constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
  WHERE rel.relname = 'chart_of_accounts' AND att.attname = 'account_subtype' AND con.contype = 'c';

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE chart_of_accounts DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;

ALTER TABLE chart_of_accounts ADD CONSTRAINT chart_of_accounts_account_subtype_check CHECK (account_subtype IN (
  'current_asset','fixed_asset','contra_asset',
  'current_liability',
  'equity','contra_equity',
  'income','other_income',
  'cogs','operating_expense','other_expense'
));

UPDATE chart_of_accounts SET account_subtype = 'other_income' WHERE system_key = 'other_income';

-- ─── DONE ────────────────────────────────────────────────────────────────────
-- After running: the app-side change (getProfitAndLoss() in ledger.js, and
-- the Accounting → Profit & Loss tab) will show a proper multi-step
-- statement: Revenue → COGS → Gross Profit → Operating Expenses →
-- Operating Income → Other Income/Expense → Net Profit. Net Profit itself
-- is numerically unchanged — this only changes how it's broken down.

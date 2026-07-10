-- =========================================================
-- RhiPower — Simple Budgeting (Accounting Module, Phase 7 — optional)
-- =========================================================
-- One row per (account, month) — the smallest useful shape for a
-- budget-vs-actual view. No auto-posting, no new journal entries; this is
-- purely a comparison layer on top of getProfitAndLoss()'s existing
-- per-account output. UNIQUE(account_id, period_month) so setting a
-- budget twice for the same month is an update (upsert), not a duplicate.
-- =========================================================

CREATE TABLE IF NOT EXISTS budgets (
  id                   UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  account_id           UUID        NOT NULL REFERENCES chart_of_accounts(id) ON DELETE CASCADE,
  period_month         DATE        NOT NULL,   -- first day of the budgeted month, e.g. '2026-08-01'
  budgeted_amount_kes  NUMERIC(12,2) NOT NULL DEFAULT 0,
  admin_id             UUID        REFERENCES admin_profiles(id) ON DELETE SET NULL,
  admin_email          TEXT,
  UNIQUE (account_id, period_month)
);

CREATE INDEX IF NOT EXISTS idx_budgets_period ON budgets(period_month);

ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_can_manage_budgets" ON budgets FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- ─── DONE ────────────────────────────────────────────────────────────────────
-- After running: the new "🎯 Budget vs Actual" tab in Accounting lets you
-- set a monthly Ksh target per income/expense account and see it compared
-- live against what actually posted that month.

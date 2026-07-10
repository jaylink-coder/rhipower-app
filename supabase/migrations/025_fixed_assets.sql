-- =========================================================
-- RhiPower — Fixed Assets + Depreciation (Accounting Module, Phase 5)
-- =========================================================
-- A fixed asset (vehicle, tool, equipment) needs its own register separate
-- from inventory_prices — it isn't sellable stock, it depreciates over time
-- rather than moving in/out, and its cost gets expensed gradually via
-- Accumulated Depreciation rather than all at once via COGS.
--
-- Deliberately NOT linked to vendor_bills: an asset bought "on credit" here
-- posts straight to Accounts Payable itself (same simplification the
-- Opening Balances wizard uses) rather than trying to reconcile against a
-- Vendor Bills row, since today's Bill line form only offers expense-type
-- accounts, not asset-type ones — avoids a double-counting risk for a
-- feature that isn't core to what was asked for.
--
-- depreciation_entries has a UNIQUE(fixed_asset_id, period_date) so
-- re-running "this month's depreciation" is always safe/idempotent, never
-- double-posts.
-- =========================================================

CREATE TABLE IF NOT EXISTS fixed_assets (
  id                     UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW(),
  asset_number           INTEGER     GENERATED ALWAYS AS IDENTITY (START WITH 1),  -- display as FA-0001
  name                   TEXT        NOT NULL,
  category               TEXT        NOT NULL CHECK (category IN ('vehicle','tool_equipment','other')),
  asset_account_id       UUID        NOT NULL REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  accum_depr_account_id  UUID        NOT NULL REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  purchase_date          DATE        NOT NULL,
  purchase_cost_kes      NUMERIC(12,2) NOT NULL CHECK (purchase_cost_kes > 0),
  salvage_value_kes      NUMERIC(12,2) NOT NULL DEFAULT 0,
  useful_life_months     INTEGER     NOT NULL CHECK (useful_life_months > 0),
  depreciation_method    TEXT        NOT NULL DEFAULT 'straight_line' CHECK (depreciation_method IN ('straight_line')),
  status                 TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active','disposed')),
  disposed_at            DATE,
  disposal_proceeds_kes  NUMERIC(12,2),
  notes                  TEXT,
  admin_id               UUID        REFERENCES admin_profiles(id) ON DELETE SET NULL,
  admin_email            TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fa_number ON fixed_assets(asset_number);
CREATE INDEX IF NOT EXISTS idx_fa_status ON fixed_assets(status);

CREATE TABLE IF NOT EXISTS depreciation_entries (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  fixed_asset_id   UUID        NOT NULL REFERENCES fixed_assets(id) ON DELETE RESTRICT,
  period_date      DATE        NOT NULL,
  amount_kes       NUMERIC(12,2) NOT NULL CHECK (amount_kes > 0),
  journal_entry_id UUID        REFERENCES journal_entries(id) ON DELETE SET NULL,
  UNIQUE (fixed_asset_id, period_date)
);

ALTER TABLE fixed_assets         ENABLE ROW LEVEL SECURITY;
ALTER TABLE depreciation_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_can_manage_fixed_assets"         ON fixed_assets         FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));
CREATE POLICY "admin_can_manage_depreciation_entries" ON depreciation_entries FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- ─── DONE ────────────────────────────────────────────────────────────────────
-- After running: the new "🏗️ Fixed Assets" admin section lets you register
-- vehicles/tools/equipment, run straight-line monthly depreciation
-- (one click for all active assets, or per-asset), and dispose of an asset
-- with an automatic gain/loss calculation.

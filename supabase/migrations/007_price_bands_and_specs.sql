-- =========================================================
-- RhiPower — Price-Band Tiers + Rich Comparison Specs
-- =========================================================
-- Previously each tier (Premium/Balanced/Budget) was hard-locked to exactly
-- one brand per category — "Balanced inverter" WAS Deye, full stop. That
-- meant no way to offer a customer a second option within the same price
-- range, and "tier" was just a label someone typed, not something derived
-- from the actual price.
--
-- This migration only lays down PROVISIONS — the structure — and does not
-- guess at any real product's spec figures. It:
--   1. Adds `price_bands` — real Ksh ranges per category (panel/inverter/
--      battery) that a product's tier is now DERIVED from, not assigned.
--      Seeded with starting ranges wide enough to keep today's 9 products
--      classified the same as before; edit them freely from the admin panel.
--   2. Adds comparison-spec columns (efficiency, warranty, degradation,
--      cycle life, DoD, MPPT count, phase) so the app CAN show a
--      phone-comparison-style table — every value starts NULL. Fill in the
--      real figures for your actual products from the new "Add/Edit Item"
--      admin page whenever you have them; nothing breaks while they're blank.
-- =========================================================

-- ─── 1. Price bands ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS price_bands (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  category   TEXT        NOT NULL,  -- 'panel' | 'inverter' | 'battery'
  tier       TEXT        NOT NULL,  -- 'budget' | 'balanced' | 'premium'
  min_price  NUMERIC(12,2) NOT NULL,
  max_price  NUMERIC(12,2),         -- NULL = unbounded (top of Premium)
  UNIQUE(category, tier)
);

ALTER TABLE price_bands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_can_read_price_bands"
  ON price_bands FOR SELECT TO anon
  USING (true);

CREATE POLICY "auth_can_manage_price_bands"
  ON price_bands FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Starting ranges — wide enough that every existing product keeps its
-- current tier. Adjust anytime from Admin -> Inventory & Prices -> Price Bands.
INSERT INTO price_bands (category, tier, min_price, max_price) VALUES
  ('panel',    'budget',   0,      16000),
  ('panel',    'balanced', 16000,  19000),
  ('panel',    'premium',  19000,  NULL),
  ('inverter', 'budget',   0,      150000),
  ('inverter', 'balanced', 150000, 350000),
  ('inverter', 'premium',  350000, NULL),
  ('battery',  'budget',   0,      250000),
  ('battery',  'balanced', 250000, 400000),
  ('battery',  'premium',  400000, NULL)
ON CONFLICT (category, tier) DO NOTHING;

-- ─── 2. Comparison-spec columns — provisions only, all start NULL ──────────
-- Shared across categories — only the columns relevant to a given product's
-- category get filled in (e.g. a battery has no mppt_count).
ALTER TABLE inventory_prices ADD COLUMN IF NOT EXISTS efficiency_pct     NUMERIC(5,2);
ALTER TABLE inventory_prices ADD COLUMN IF NOT EXISTS warranty_years     NUMERIC(4,1);
ALTER TABLE inventory_prices ADD COLUMN IF NOT EXISTS degradation_pct_yr NUMERIC(5,3);
ALTER TABLE inventory_prices ADD COLUMN IF NOT EXISTS mppt_count         INTEGER;
ALTER TABLE inventory_prices ADD COLUMN IF NOT EXISTS phase              TEXT;   -- 'single' | 'three'
ALTER TABLE inventory_prices ADD COLUMN IF NOT EXISTS cycle_life         INTEGER;
ALTER TABLE inventory_prices ADD COLUMN IF NOT EXISTS dod_pct            NUMERIC(5,2);

-- ─── DONE ────────────────────────────────────────────────────────────────────
-- After running: /admin -> Inventory & Prices will show a new "Price Bands"
-- panel (editable ranges) and every product row will show its tier as
-- derived live from price_bands rather than a fixed label. Use "+ Add Item"
-- to add real alternative brands within any tier, with as many or as few of
-- the new spec fields filled in as you actually know.

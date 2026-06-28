-- =========================================================
-- RhiPower — Inventory Prices Table + Seed Data
-- =========================================================
-- HOW TO USE:
--   1. Supabase → SQL Editor → New query
--   2. Paste this file and click Run
--   3. Your 22 inventory items are live and editable
--      from the Admin page in the app
-- =========================================================

-- ─── TABLE: inventory_prices ─────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_prices (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  role_key         TEXT        NOT NULL UNIQUE,  -- internal key used by calculator
  sku              TEXT        NOT NULL,
  description      TEXT        NOT NULL,
  tier             TEXT,        -- 'premium' | 'balanced' | 'budget' | 'common'
  category         TEXT,        -- 'panel' | 'inverter' | 'battery' | 'protection' | 'cable'
  unit             TEXT        DEFAULT 'each',  -- 'each' | 'metre' | 'set'
  buying_price_kes NUMERIC(12,2) NOT NULL,
  -- Technical specs (null where not applicable)
  watts_each       NUMERIC(8,2),
  kwh_each         NUMERIC(8,2),
  kw_each          NUMERIC(8,2),
  unit_weight_kg   NUMERIC(6,2),
  -- Stock management
  in_stock         BOOLEAN     DEFAULT true,
  supplier         TEXT,
  notes            TEXT,
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ─── ROW-LEVEL SECURITY ──────────────────────────────────
ALTER TABLE inventory_prices ENABLE ROW LEVEL SECURITY;

-- App (anonymous) can READ prices for quoting
CREATE POLICY "anon_can_read_inventory"
  ON inventory_prices FOR SELECT TO anon
  USING (true);

-- Authenticated admin can read and update prices
CREATE POLICY "auth_can_read_inventory"
  ON inventory_prices FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "auth_can_update_inventory"
  ON inventory_prices FOR UPDATE TO authenticated
  USING (true);

-- ─── INDEX ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_inventory_role ON inventory_prices(role_key);
CREATE INDEX IF NOT EXISTS idx_inventory_tier ON inventory_prices(tier);

-- ─── SEED DATA — all 22 items ────────────────────────────
INSERT INTO inventory_prices
  (role_key, sku, description, tier, category, unit, buying_price_kes, watts_each, kwh_each, kw_each, unit_weight_kg)
VALUES
  -- ── SOLAR PANELS ─────────────────────────────────────────
  ('premium_panel',    'LR7-72HGD-620M',    'LONGi Hi-MO 7 620W Bifacial Dual-Glass Panel',          'premium',  'panel',      'each',  18500, 620,  NULL, NULL, 33.5),
  ('balanced_panel',   'LR7-72HGD-620M',    'LONGi Hi-MO 7 620W Bifacial Dual-Glass Panel',          'balanced', 'panel',      'each',  18500, 620,  NULL, NULL, 33.5),
  ('budget_panel',     'GEN-MONO-550W',     'Tier-1 550W Monocrystalline Solar Module',               'budget',   'panel',      'each',  14500, 550,  NULL, NULL, 28.0),

  -- ── INVERTERS ────────────────────────────────────────────
  ('premium_inverter', 'VIC-QUAT-48-15K',   'Victron Energy Quattro 15kVA Premium Inverter/Charger',  'premium',  'inverter',   'each', 420000, NULL, NULL, 15.0, 45.0),
  ('balanced_inverter','FL-INV-3P-20KW',    'Felicity 20kW 3-Phase Industrial MPPT Inverter',         'balanced', 'inverter',   'each', 260000, NULL, NULL, 20.0, 42.0),
  ('budget_inverter',  'MUST-PH18-5KW',     'Must Energy 5.2kW Hybrid Solar Inverter',                'budget',   'inverter',   'each',  85000, NULL, NULL,  5.2, 12.0),

  -- ── BATTERIES ────────────────────────────────────────────
  ('premium_battery',  'BYD-LV-FLEX-15',    'BYD 15.4kWh Premium Lithium LiFePO₄ Battery Pack',      'premium',  'battery',    'each', 480000, NULL, 15.4, NULL, 140.0),
  ('balanced_battery', 'FL-BATT-48V-15KWH', 'Felicity 15kWh Premium Lithium LiFePO₄ Battery Pack',   'balanced', 'battery',    'each', 315000, NULL, 15.0, NULL, 125.0),
  ('budget_battery',   'GEN-WALL-10KWH',    'Market Standard 10.2kWh Lithium Battery Pack',           'budget',   'battery',    'each', 195000, NULL, 10.2, NULL,  85.0),

  -- ── ZONE A: SOLAR ARRAY PROTECTION ───────────────────────
  ('zoneA_breaker',    'DC-BREAKER-63A',    'Chint NBI-63DC 2-Pole 1000V DC Isolator Breaker',        'common',   'protection', 'each',   3500, NULL, NULL, NULL,  0.8),
  ('zoneA_spd',        'DC-SPD-1000V',      'Chint NU6 Type 2 Heavy-Duty DC Surge Protective Device', 'common',   'protection', 'each',   4200, NULL, NULL, NULL,  0.5),
  ('zoneA_fuse',       'DC-FUSE-15A',       'Mersen 1000V DC PV Fuse Holder + Link 15A',              'common',   'protection', 'each',    850, NULL, NULL, NULL,  0.1),
  ('zoneA_cable6',     'CABLE-DC-6MM',      '6mm² Kinu Copper DC Solar Cable',                        'common',   'cable',      'metre',   180, NULL, NULL, NULL,  0.1),
  ('zoneA_cable10',    'CABLE-DC-10MM',     '10mm² Kinu Copper DC Solar Cable',                       'common',   'cable',      'metre',   280, NULL, NULL, NULL,  0.1),

  -- ── ZONE B: BATTERY BANK CONNECTIONS ─────────────────────
  ('zoneB_mccb',       'DC-MCCB-400A',      'Chint NM8N 400A 2-Pole High-Current DC Battery MCCB',   'common',   'protection', 'each',  18500, NULL, NULL, NULL,  3.2),
  ('zoneB_busbar',     'COPPER-BUSBAR',     'Solid Tinned Copper Multi-Battery Interconnection Busbar','common',  'protection', 'set',    9000, NULL, NULL, NULL,  1.5),
  ('zoneB_lug_m8',     'LUG-50-M8',         'Tinned 50mm² Copper Lug — M8 (Battery Terminals)',       'common',   'protection', 'each',     65, NULL, NULL, NULL,  0.05),
  ('zoneB_lug_m10',    'LUG-50-M10',        'Tinned 50mm² Copper Lug — M10 (Inverter Terminals)',     'common',   'protection', 'each',     75, NULL, NULL, NULL,  0.05),
  ('zoneB_batcable',   'CABLE-BAT-50MM',    '50mm² Flexible Rubber Heat-Resistant Battery Cable',     'common',   'cable',      'metre',  1100, NULL, NULL, NULL,  0.5),

  -- ── ZONE C: AC DISTRIBUTION ──────────────────────────────
  ('zoneC_mcb',        'AC-MCB-3P-63A',     'Chint 3-Phase 63A Mains AC Overload Circuit Breaker',    'common',   'protection', 'each',   4500, NULL, NULL, NULL,  0.4),
  ('zoneC_smart',      'SMART-BREAKER',     'Tuya 40A Wi-Fi Smart DIN-Rail Breaker (Rain Automator)', 'common',   'protection', 'each',   6500, NULL, NULL, NULL,  0.2),
  ('zoneC_contactor',  'AC-CONTACTOR-40A',  'Chint 40A 2-Pole Heavy-Duty AC Power Contactor Relay',  'common',   'protection', 'each',   3800, NULL, NULL, NULL,  0.3)

ON CONFLICT (role_key) DO NOTHING;

-- ─── DONE ────────────────────────────────────────────────
-- 22 items loaded. Go to Table Editor → inventory_prices to verify.
-- To update a price: use the Admin page in the app (after setup),
-- or update directly here with:
-- UPDATE inventory_prices SET buying_price_kes = 20000 WHERE role_key = 'premium_panel';

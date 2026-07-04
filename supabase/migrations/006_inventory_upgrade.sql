-- =========================================================
-- RhiPower — Inventory Upgrade: Missing BOM Items, Stock Tracking, Real Brands
-- =========================================================
-- Closes gaps found during a market research pass (2026-07-04):
--   1. Mounting/racking structure and earthing/lightning protection were
--      completely absent from every quote ever generated — both are real,
--      often-substantial costs (mounting ~Ksh 14,000/kW; earthing kit
--      ~Ksh 20,000-25,000), and earthing is a code-mandated safety item,
--      not optional trim.
--   2. Balanced/Budget tier inverters were branded Felicity/Must Energy,
--      but Deye and Growatt are the actual dominant "best value" hybrid
--      inverter brands in the Kenyan market — swapped to real current
--      models with verified Kenya pricing (Deye SUN-12K ~Ksh 253k-306k
--      across multiple Kenyan retailers; Growatt SPF 5000 ES ~Ksh 83k).
--   3. `stock_qty` / `reorder_point` replace the old binary in_stock-only
--      model — lets the admin panel show "12 in stock, reorder at 5"
--      instead of just a toggle. Nullable: NULL means "not yet tracked",
--      so nothing breaks for rows the admin hasn't set counts for yet.
-- =========================================================

-- ─── 1. Stock quantity tracking columns ─────────────────────────────────────
ALTER TABLE inventory_prices ADD COLUMN IF NOT EXISTS stock_qty      INTEGER;
ALTER TABLE inventory_prices ADD COLUMN IF NOT EXISTS reorder_point  INTEGER;

-- ─── 2. Swap Balanced tier inverter: Felicity 20kW → Deye SUN-12K (real, verified) ──
-- Multiple Kenyan retailers (Multline, Colcal, Allectrify) price this 12kW
-- 3-phase 2-MPPT unit at Ksh 253,500-305,600; using Ksh 270,000 as the
-- wholesale buying price RhiPower would realistically pay.
UPDATE inventory_prices SET
  sku              = 'DEYE-SUN12K-SG04LP3',
  description      = 'Deye SUN-12K-SG04LP3-EU 12kW 3-Phase 2-MPPT Hybrid Inverter',
  buying_price_kes = 270000,
  kw_each          = 12,
  unit_weight_kg   = 36,
  updated_at       = NOW()
WHERE role_key = 'balanced_inverter';

-- ─── 3. Swap Budget tier inverter: Must Energy 5.2kW → Growatt SPF 5000 ES (real, verified) ──
-- Verified Kenya retail price (TDK Kenya) Ksh 83,000 for the 5kW/5000VA unit.
UPDATE inventory_prices SET
  sku              = 'GROWATT-SPF5000ES',
  description      = 'Growatt SPF 5000 ES 5kW Hybrid Inverter',
  buying_price_kes = 83000,
  kw_each          = 5,
  unit_weight_kg   = 12,
  updated_at       = NOW()
WHERE role_key = 'budget_inverter';

-- ─── 4. New Zone A items: Mounting Structure + Earthing/Lightning Protection ──
-- Priced per kWp (mounting scales with array size) and per-system flat rate
-- (earthing kit), matching real Kenya market pricing found for both.
INSERT INTO inventory_prices
  (role_key, sku, description, tier, category, unit, buying_price_kes, notes)
VALUES
  ('zoneA_mounting', 'MOUNT-ALU-KIT', 'Aluminium Roof Mounting Structure (rails, clamps, L-feet)', 'common', 'mounting', 'kw',   14000, 'Priced per kWp of array — scales with panel count'),
  ('zoneA_earthing', 'EARTH-LA-KIT',  'Earthing & Lightning Protection Kit (rods, arrestor, bonding cable)', 'common', 'safety', 'set', 22000, 'One kit per system — code-mandated for rooftop PV')
ON CONFLICT (role_key) DO NOTHING;

-- ─── DONE ────────────────────────────────────────────────────────────────────
-- After running: open /admin → Inventory & Prices and confirm you see
-- "Deye" and "Growatt" as the Balanced/Budget inverters, and two new rows
-- under Zone A for mounting + earthing. Existing quotes are unaffected
-- (this only changes pricing/BOM going forward).

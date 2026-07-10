-- =========================================================
-- RhiPower — Full Component Spec Schema (Panels / Inverters / Batteries)
-- =========================================================
-- Migration 007 provisioned a first, shallow set of comparison-spec columns
-- (efficiency, warranty, degradation, MPPT count, phase, cycle life, DoD) —
-- always meant to grow. This adds the real differentiators that actually
-- distinguish solar equipment on a datasheet: cell chemistry/technology,
-- temperature coefficient, inverter continuous/surge power, comm protocols,
-- battery C-rate, plus generic electrical/environmental/dimension fields
-- shared across all three categories.
--
-- Same "provisions only" pattern as migration 007: every column is
-- nullable, nothing is guessed for the 9 real products that already exist —
-- fill in real datasheet figures from the admin "Add/Edit Item" page
-- whenever you have them. Nothing breaks while they're blank; the sizing
-- calculator (separate app-side change) only uses these once populated.
-- =========================================================

-- ─── Common — dimensions, electrical, environmental (all 3 categories) ─────
ALTER TABLE inventory_prices ADD COLUMN IF NOT EXISTS length_mm            NUMERIC(8,1);
ALTER TABLE inventory_prices ADD COLUMN IF NOT EXISTS width_mm             NUMERIC(8,1);
ALTER TABLE inventory_prices ADD COLUMN IF NOT EXISTS thickness_mm         NUMERIC(8,1);
ALTER TABLE inventory_prices ADD COLUMN IF NOT EXISTS nominal_voltage_v    NUMERIC(8,2);
ALTER TABLE inventory_prices ADD COLUMN IF NOT EXISTS max_current_amps     NUMERIC(8,2);
ALTER TABLE inventory_prices ADD COLUMN IF NOT EXISTS operating_temp_min_c NUMERIC(5,1);
ALTER TABLE inventory_prices ADD COLUMN IF NOT EXISTS operating_temp_max_c NUMERIC(5,1);
ALTER TABLE inventory_prices ADD COLUMN IF NOT EXISTS ip_rating            TEXT;   -- e.g. 'IP65'

-- ─── Panel-specific ─────────────────────────────────────────────────────────
ALTER TABLE inventory_prices ADD COLUMN IF NOT EXISTS cell_type              TEXT;          -- 'mono_n_type' | 'mono_p_type' | 'poly'
ALTER TABLE inventory_prices ADD COLUMN IF NOT EXISTS temp_coefficient_pct_c NUMERIC(5,3);  -- %/°C power loss above 25°C STC, typically negative

-- ─── Inverter-specific ──────────────────────────────────────────────────────
ALTER TABLE inventory_prices ADD COLUMN IF NOT EXISTS inverter_type      TEXT;      -- 'hybrid' | 'string' | 'micro'
ALTER TABLE inventory_prices ADD COLUMN IF NOT EXISTS continuous_power_w NUMERIC(9,1);
ALTER TABLE inventory_prices ADD COLUMN IF NOT EXISTS surge_power_w      NUMERIC(9,1);
ALTER TABLE inventory_prices ADD COLUMN IF NOT EXISTS comm_protocols     TEXT;      -- free text, e.g. 'CAN, RS485' — same pattern as existing `phase` column

-- ─── Battery-specific ───────────────────────────────────────────────────────
ALTER TABLE inventory_prices ADD COLUMN IF NOT EXISTS chemistry_type    TEXT;          -- 'lifepo4' | 'lead_acid' | 'lto' | 'sodium_ion'
ALTER TABLE inventory_prices ADD COLUMN IF NOT EXISTS max_charge_rate_c NUMERIC(4,2);  -- C-rate, e.g. 1.0 = 1C

-- ─── DONE ────────────────────────────────────────────────────────────────────
-- After running: every inventory item can carry the full datasheet spec set.
-- Nothing in the admin UI or customer-facing app reads these columns yet —
-- that's the next phase (ItemForm fields, customer spec-sheet display, and
-- the sizing calculator's temperature-derating/DoD/C-rate logic), which I'll
-- build once you confirm this migration ran successfully.

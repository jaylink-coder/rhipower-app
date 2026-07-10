-- =========================================================
-- RhiPower — MPPT String-Balancing Fields
-- =========================================================
-- Adds the electrical spec fields needed to check whether a chosen panel
-- and inverter can actually be wired together safely — the MPPT voltage
-- window has to fit the panel's real Voc/Vmp across Kenya's real
-- temperature swings, and the inverter's max input current has to cover
-- the panel's Isc across however many strings run in parallel.
--
-- Reuses migration 029's `nominal_voltage_v` (as a panel's Vmp) and
-- `max_current_amps` (as a panel's Isc, or an inverter's max current per
-- MPPT tracker) rather than duplicating columns — only the fields with no
-- existing equivalent are added here: a panel's Voc (higher than Vmp,
-- the value that matters for cold-weather string voltage limits), and an
-- inverter's MPPT operating window plus absolute max input voltage.
-- =========================================================

ALTER TABLE inventory_prices ADD COLUMN IF NOT EXISTS voc_v NUMERIC(8,2);              -- panel: open-circuit voltage
ALTER TABLE inventory_prices ADD COLUMN IF NOT EXISTS mppt_min_voltage_v NUMERIC(8,2);  -- inverter: MPPT tracking window floor
ALTER TABLE inventory_prices ADD COLUMN IF NOT EXISTS mppt_max_voltage_v NUMERIC(8,2);  -- inverter: MPPT tracking window ceiling
ALTER TABLE inventory_prices ADD COLUMN IF NOT EXISTS max_input_voltage_v NUMERIC(8,2); -- inverter: absolute max DC input before damage

-- ─── DONE ────────────────────────────────────────────────────────────────────
-- After running: every inventory item can carry the fields the string-
-- balancing engine (src/lib/stringBalancing.ts) needs. Nothing reads them
-- yet until the calculator integration ships — nullable, no risk to
-- existing quotes.

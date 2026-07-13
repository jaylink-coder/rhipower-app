-- =========================================================
-- RhiPower — Backfill specs_verified for Researched Rows
-- =========================================================
-- One-time follow-up to migration 032_specs_verified_lock.sql. Marks the
-- rows already loaded by seed_real_product_specs.sql and
-- seed_researched_brands_2026-07.sql as specs_verified = true wherever
-- their technical specs actually came from a real manufacturer datasheet —
-- so the Add/Edit form locks those fields against accidental overwrites.
--
-- NOT a blanket "mark everything true" — six brand blocks are deliberately
-- excluded because their specs are NOT manufacturer-datasheet-sourced:
--   - solarmax_%, premier_%, solarnyumbani_%, amizar_%  → confirmed
--     generic/white-label brands, retailer-claimed specs only (Trust
--     Tier 3 in PRODUCT_RESEARCH_LOG.md — explicitly NOT to be treated
--     as verified, same as they're flagged "⚠️ UNVERIFIED/GENERIC BRAND"
--     in the UI today).
--   - chlorideexide_%, eastman_%                        → real
--     manufacturers, but owner decision was "stay at enumeration depth" —
--     no official datasheet pass was done, so every technical field on
--     these rows is NULL anyway. Excluding them is belt-and-suspenders:
--     the second condition below (at least one spec field populated)
--     already means these rows wouldn't qualify regardless.
--
-- The "at least one technical field is non-null" condition is the real
-- safety net: it's what keeps this UPDATE from ever touching the original
-- inventory_seed.sql placeholder rows or any future admin-typed entry
-- that happens not to start with one of the six excluded prefixes — those
-- rows have nothing in the technical columns, so they never qualify.
--
-- Idempotent / safe to re-run: this only ever sets specs_verified = true
-- for rows matching the criteria below; it never sets it back to false
-- (that only happens when an admin explicitly unlocks and re-saves a
-- verified row in the app itself — see ItemForm.tsx).
-- =========================================================

UPDATE inventory_prices
SET specs_verified = true
WHERE role_key NOT LIKE 'solarmax_%'
  AND role_key NOT LIKE 'premier_%'
  AND role_key NOT LIKE 'solarnyumbani_%'
  AND role_key NOT LIKE 'amizar_%'
  AND role_key NOT LIKE 'chlorideexide_%'
  AND role_key NOT LIKE 'eastman_%'
  AND (
    length_mm IS NOT NULL OR width_mm IS NOT NULL OR thickness_mm IS NOT NULL OR
    nominal_voltage_v IS NOT NULL OR max_current_amps IS NOT NULL OR
    operating_temp_min_c IS NOT NULL OR operating_temp_max_c IS NOT NULL OR ip_rating IS NOT NULL OR
    efficiency_pct IS NOT NULL OR warranty_years IS NOT NULL OR degradation_pct_yr IS NOT NULL OR
    cell_type IS NOT NULL OR temp_coefficient_pct_c IS NOT NULL OR voc_v IS NOT NULL OR
    mppt_count IS NOT NULL OR phase IS NOT NULL OR inverter_type IS NOT NULL OR
    continuous_power_w IS NOT NULL OR surge_power_w IS NOT NULL OR comm_protocols IS NOT NULL OR
    mppt_min_voltage_v IS NOT NULL OR mppt_max_voltage_v IS NOT NULL OR max_input_voltage_v IS NOT NULL OR
    cycle_life IS NOT NULL OR dod_pct IS NOT NULL OR chemistry_type IS NOT NULL OR max_charge_rate_c IS NOT NULL
  );

-- ─── DONE ────────────────────────────────────────────────────────────────────
-- Run this AFTER migration 032 and AFTER both seed_real_product_specs.sql
-- and seed_researched_brands_2026-07.sql have already been run (they have).
-- Check the row count Postgres reports after running — with 241 researched
-- rows minus the ~40 rows across the six excluded prefixes, minus rows in
-- those files with no technical fields at all, expect roughly 180-200 rows
-- updated. After this, reload /admin → Inventory & Prices and open any
-- panel/inverter/battery sourced from a real datasheet — its spec fields
-- should now show a 🔒 lock banner in the Edit form.

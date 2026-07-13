-- =========================================================
-- RhiPower — Verified-Spec Lock
-- =========================================================
-- Every technical spec in this catalog either traces to a real manufacturer
-- datasheet or is honestly flagged as retailer-claimed/unverified (see
-- supabase/PRODUCT_RESEARCH_LOG.md's trust-tier convention). Up to now
-- nothing in the schema captured that distinction, so an admin editing an
-- item had no signal that, say, a LONGi panel's Voc came from an official
-- PDF and shouldn't be casually retyped from memory or a guess.
--
-- specs_verified = true means: the technical spec fields on this row
-- (dimensions, electrical, environmental, and the panel/inverter/battery-
-- specific columns) were populated from an official manufacturer datasheet.
-- The app's Add/Edit form locks those fields when true, with an explicit
-- unlock control for the rare legitimate correction (wrong model mapped,
-- typo caught later) — this is a soft guardrail against accidental
-- overwrites, not a hard/immutable lock enforced at the DB layer.
--
-- Pricing, stock, supplier, description, and SKU are NOT covered by this
-- flag — those change routinely and aren't "specs" in this sense.
-- =========================================================

ALTER TABLE inventory_prices ADD COLUMN IF NOT EXISTS specs_verified BOOLEAN NOT NULL DEFAULT false;

-- ─── DONE ────────────────────────────────────────────────────────────────────
-- After running: every row defaults to unlocked (false) — including all
-- rows already in the table. See seed_verify_researched_specs_2026-07.sql
-- (same directory) for the follow-up UPDATE that marks the specific rows
-- researched from official manufacturer datasheets as verified.

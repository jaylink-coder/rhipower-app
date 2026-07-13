-- =========================================================
-- RhiPower — Per-Item Margin Override + Wholesale Quantity Break
-- =========================================================
-- Every quote and every inventory list has always applied one flat 35%
-- margin to buying price (hardcoded as `* 1.35` in calculator.js and
-- Admin.jsx) with no way to price an individual item differently — a
-- brand with a tighter supplier margin or a slow-moving item needing a
-- push couldn't be priced differently from everything else.
--
-- margin_pct = NULL means "use the 35% default," same as every existing
-- row today — this migration changes nothing about current prices on its
-- own. Setting margin_pct on a row (e.g. 40 for a 40% markup) overrides
-- the default for that row only, in both the admin inventory list AND
-- the actual customer-facing quote math (calculator.js), since both now
-- read from the same per-item value.
--
-- wholesale_price_kes / wholesale_min_qty add a manually-set bulk-quantity
-- floor on top of that: a customer buying at least wholesale_min_qty units
-- of a line item pays wholesale_price_kes per unit instead of the usual
-- margin price, for that entire line. Both must be set together — a
-- wholesale price with no qty threshold (or vice versa) is treated as "not
-- configured" and the item just prices at the normal margin. This is a
-- hard cutoff, not a sliding scale: below the threshold, full margin price;
-- at or above it, every unit in that line is priced at the wholesale rate.
-- =========================================================

ALTER TABLE inventory_prices ADD COLUMN IF NOT EXISTS margin_pct NUMERIC(6,2);
ALTER TABLE inventory_prices ADD COLUMN IF NOT EXISTS wholesale_price_kes NUMERIC(12,2);
ALTER TABLE inventory_prices ADD COLUMN IF NOT EXISTS wholesale_min_qty INTEGER;

-- ─── DONE ────────────────────────────────────────────────────────────────────
-- After running: every row still prices at the 35% default until an admin
-- sets a per-item margin override, and no row has a wholesale tier until
-- both wholesale fields are set together via the Add/Edit form's new
-- Pricing section.

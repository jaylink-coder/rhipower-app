-- =========================================================
-- RhiPower — Stock Valuation (weighted-average cost)
-- =========================================================
-- Phase 5 (Reporting) of the ERP build-out. Real stock valuation and gross
-- margin reporting need a real per-item cost that isn't just "whatever
-- buying_price_kes happens to be typed in right now" — this column is
-- maintained by the app layer (AdminPurchaseOrders.jsx's receive line
-- action) on every PO receipt using the standard weighted-average formula:
--   new_avg = (old_avg * old_qty + received_qty * unit_cost) / (old_qty + received_qty)
-- Weighted-average, not FIFO, matches this codebase's existing no-lot,
-- single-location design (no per-batch tracking infrastructure exists or
-- is wanted — see migration 008's comment on the same tradeoff for serial
-- tracking). NULL until an item's first PO receipt — reports fall back to
-- buying_price_kes for items that have never been received against a PO
-- (e.g. legacy stock entered before Purchase Orders existed).
-- =========================================================

ALTER TABLE inventory_prices ADD COLUMN IF NOT EXISTS weighted_avg_cost_kes NUMERIC(12,2);

-- ─── DONE ────────────────────────────────────────────────────────────────────
-- After running: receiving a Purchase Order line will start updating this
-- column, and Reports -> Stock Valuation will show real weighted-average
-- costs for every item that's had at least one PO receipt.

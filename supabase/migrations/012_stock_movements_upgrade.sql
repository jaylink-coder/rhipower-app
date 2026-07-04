-- =========================================================
-- RhiPower — Stock Movement Ledger Upgrade
-- =========================================================
-- Turns stock_movements from "a signed number + a free-text reason" into a
-- real audit trail: every row now says WHAT KIND of change this was and,
-- where applicable, WHICH purchase order caused it. source_type/source_id
-- is a deliberately unenforced (no FK) polymorphic link — matching the
-- codebase's existing comfort with unenforced links (e.g. quotation_requests'
-- panel_role_key/etc. from migration 009) — disambiguated by source_type,
-- validated at the application layer via the new logStockMovement() helper.
--
-- Existing rows backfill as 'adjustment', which is accurate: every row
-- written before this migration came from the manual stock-qty edit form.
-- =========================================================

ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS movement_type TEXT NOT NULL DEFAULT 'adjustment';
-- 'purchase' | 'sale' | 'adjustment' | 'return' | 'reservation' | 'reservation_release'

ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS source_type TEXT;   -- 'purchase_order' | 'sales_order' | NULL
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS source_id   UUID;  -- id in whichever table source_type names

CREATE INDEX IF NOT EXISTS idx_stock_movements_source ON stock_movements(source_type, source_id);

-- ─── DONE ────────────────────────────────────────────────────────────────────
-- After running: receiving a Purchase Order line writes a stock_movements row
-- tagged movement_type='purchase' with source_type/source_id pointing back at
-- the PO. Manual adjustments from the existing Inventory & Prices panel keep
-- working exactly as before, now correctly tagged movement_type='adjustment'.

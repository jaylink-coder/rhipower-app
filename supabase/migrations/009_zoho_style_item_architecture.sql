-- =========================================================
-- RhiPower — Adopt Zoho Inventory's Item Architecture
-- =========================================================
-- Modeled directly on the user's real Zoho Invoice/Inventory account
-- (Jaylink Power Systems): sequential item codes, an Active/Inactive
-- distinction separate from stock-on-hand, and a Transactions record of
-- which real jobs actually used a given item — alongside the History
-- (stock ledger) already built in migration 008.
--
--   1. item_code — sequential human-readable number per item, like Zoho's
--      "Item barcode: 1442". Independent of role_key (which stays the
--      stable internal identifier for all FKs/lookups).
--   2. is_active — "do we still sell this SKU at all" (Zoho's
--      Mark as Inactive), distinct from in_stock ("do we have units right
--      now"). An inactive item disappears from customer-facing quoting but
--      stays fully visible in admin for historical reference.
--   3. panel_role_key / inverter_role_key / battery_role_key on
--      quotation_requests — records which SPECIFIC product (not just
--      which tier) a quote actually used, so a "Transactions" view per
--      item is possible going forward. Existing rows stay NULL — there's
--      no way to retroactively know which brand a past quote used before
--      the brand-picker feature existed, and guessing would misattribute
--      real customer records.
-- =========================================================

-- ─── 1. Sequential item code ────────────────────────────────────────────────
ALTER TABLE inventory_prices ADD COLUMN IF NOT EXISTS item_code INTEGER GENERATED ALWAYS AS IDENTITY (START WITH 1001);

-- ─── 2. Active/Inactive, separate from in_stock ─────────────────────────────
ALTER TABLE inventory_prices ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- ─── 3. Which specific product a quote used ─────────────────────────────────
ALTER TABLE quotation_requests ADD COLUMN IF NOT EXISTS panel_role_key    TEXT;
ALTER TABLE quotation_requests ADD COLUMN IF NOT EXISTS inverter_role_key TEXT;
ALTER TABLE quotation_requests ADD COLUMN IF NOT EXISTS battery_role_key TEXT;
-- Deliberately no FK here: a quote's historical record must stay intact
-- even if the product it referenced is later deleted or renamed.

CREATE INDEX IF NOT EXISTS idx_quotations_panel_role    ON quotation_requests(panel_role_key);
CREATE INDEX IF NOT EXISTS idx_quotations_inverter_role ON quotation_requests(inverter_role_key);
CREATE INDEX IF NOT EXISTS idx_quotations_battery_role  ON quotation_requests(battery_role_key);

-- ─── DONE ────────────────────────────────────────────────────────────────────
-- After running: every inventory item shows a sequential #item_code, admin
-- can mark items inactive without losing stock history, and new quotes
-- (going forward only) record which exact brand/model was used.

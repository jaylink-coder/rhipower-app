-- =========================================================
-- RhiPower — Purchase Order Lifecycle Statuses
-- =========================================================
-- The old status set ('draft' | 'ordered' | 'partially_received' |
-- 'received' | 'cancelled') collapsed "sent to supplier," "supplier
-- confirmed," and "goods physically arrived" into a single 'ordered'
-- state — no way to tell those apart, and no way to actually send the PO
-- itself (email/WhatsApp) from within the app.
--
-- New set: 'draft' | 'sent' | 'accepted' | 'delivered' |
-- 'partially_received' | 'received' | 'cancelled'. No CHECK constraint
-- exists on this column (see migration 011), so this is a data cleanup +
-- documentation update, not a schema change — existing 'ordered' rows are
-- renamed to 'sent' so every row matches a status the UI now recognizes.
-- =========================================================

UPDATE purchase_orders SET status = 'sent' WHERE status = 'ordered';

COMMENT ON COLUMN purchase_orders.status IS
  'draft | sent | accepted | delivered | partially_received | received | cancelled';

-- ─── DONE ────────────────────────────────────────────────────────────────────
-- After running: open Purchasing → any draft PO now shows WhatsApp/Email
-- "send to supplier" buttons, and the status pill options include the full
-- sent → accepted → delivered → received lifecycle.

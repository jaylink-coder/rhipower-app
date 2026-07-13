-- =========================================================
-- RhiPower — Supplier KRA PIN
-- =========================================================
-- customer_profiles already carries a kra_pin (migration 016-ish, used on
-- invoices for tax purposes). Suppliers had no equivalent, even though a
-- supplier's PIN matters just as much for vendor bills/WHT record-keeping.
-- Bringing the Suppliers detail page up to the same level of detail as
-- Customers surfaced the gap.
-- =========================================================

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS kra_pin TEXT;

-- ─── DONE ────────────────────────────────────────────────────────────────────
-- After running: the Suppliers form/detail view has a KRA PIN field
-- alongside the existing contact fields.

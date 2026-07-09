-- =========================================================
-- RhiPower — VAT status columns on Sales Order / Invoice lines
-- =========================================================
-- Split out from migrations 013/014 because those had already been run
-- before this change was written — editing an already-applied migration
-- file is wrong (it stops matching what's actually in the database), so
-- this adds the same two columns via ALTER TABLE instead. 013 and 014 have
-- been reverted back to exactly what they were when you ran them.
--
-- sales_order_lines.vat_status — frozen snapshot of the item's VAT status
--   (see migration 016's inventory_prices.vat_status) at the moment a
--   quote is converted to a Sales Order.
-- invoice_lines.vat_status / vat_amount_kes — each invoice line now carries
--   its own tax treatment and computed VAT amount, since an invoice groups
--   Sales Order lines by (zone, vat_status) rather than applying one
--   blanket rate to the whole total. See lib/invoices.js.
-- =========================================================

ALTER TABLE sales_order_lines ADD COLUMN IF NOT EXISTS vat_status TEXT NOT NULL DEFAULT 'standard'
  CHECK (vat_status IN ('standard', 'zero_rated', 'exempt'));

ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS vat_status TEXT NOT NULL DEFAULT 'standard'
  CHECK (vat_status IN ('standard', 'zero_rated', 'exempt'));
ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS vat_amount_kes NUMERIC(12,2) NOT NULL DEFAULT 0;

-- ─── DONE ────────────────────────────────────────────────────────────────────
-- After running: converting a quote to a Sales Order and generating an
-- invoice from it will both work again — they insert these columns and
-- were failing (or would have failed) without them.

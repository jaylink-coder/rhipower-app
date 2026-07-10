-- =========================================================
-- RhiPower — Accounting Module Phase 2: Revenue Categorization
-- =========================================================
-- Tags each invoice line with which Sales Revenue account it belongs to
-- (materials / labour / logistics), set explicitly by
-- generateInvoiceFromSalesOrder() in src/lib/invoices.js at creation time —
-- NOT derived by parsing invoice_lines.description later, which would be
-- fragile against the "— Zero-rated"/"— Exempt" suffix appended when a zone
-- splits across vat_status groups. This is what the new invoice-creation
-- journal entry (see lib/ledger.js) uses to credit the right Sales Revenue
-- sub-account.
-- =========================================================

ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS revenue_category TEXT
  CHECK (revenue_category IN ('materials', 'labour', 'logistics'));

-- ─── DONE ────────────────────────────────────────────────────────────────────
-- After running: new invoices tag each line with its revenue category and
-- post a real journal entry (Dr Accounts Receivable / Cr Sales Revenue ×3 /
-- Cr Output VAT Payable). Existing invoices created before this migration
-- keep revenue_category = NULL — harmless, since nothing reads it
-- retroactively; their numbers just won't appear in the GL (a natural gap
-- to close via the Opening Balances wizard's Accounts Receivable line).

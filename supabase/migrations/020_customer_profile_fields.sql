-- =========================================================
-- RhiPower — Real Customer Profile Fields
-- =========================================================
-- customer_profiles was deliberately kept thin (id, email, full_name,
-- status) because phone/address could always be pulled from a customer's
-- most recent quote — that held up as long as every customer came through
-- the quote flow first. It stopped holding up once admins could create a
-- customer account directly (see AdminCustomers.jsx's "+ Add Customer"):
-- a freshly-created account has no quote to derive anything from.
--
-- Modeled on the user's real Zoho customer record (Company Name / Contact
-- Person split, Billing vs. Shipping address) plus what Kenyan B2B
-- invoicing actually needs (a customer's KRA PIN, same reasoning as
-- org_settings.kra_pin for RhiPower's own). All nullable — existing
-- customers keep working exactly as before (their contact info still shows
-- via the quote-derived fallback already in AdminCustomers.jsx) until an
-- admin fills these in.
-- =========================================================

ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS customer_type TEXT NOT NULL DEFAULT 'individual'
  CHECK (customer_type IN ('individual', 'business'));
ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS company_name    TEXT;
ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS contact_person  TEXT;
ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS phone           TEXT;
ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS kra_pin         TEXT;
ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS billing_address TEXT;
ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS site_address    TEXT;
ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS notes           TEXT;

-- No new RLS policy needed — migration 017 already added
-- "admin_can_update_customer_profiles" (FOR UPDATE), which covers these
-- new columns too since Postgres RLS policies apply at the row level, not
-- per-column.

-- ─── DONE ────────────────────────────────────────────────────────────────────
-- After running: the Customer Detail view (click a customer in Customers)
-- gets an Edit button on Overview to fill in these fields directly.

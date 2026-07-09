-- =========================================================
-- RhiPower — Organization Settings
-- =========================================================
-- A singleton settings row replacing what's currently hardcoded in
-- src/config.js (business name/contact/KRA PIN) and scattered literals in
-- src/lib/invoices.js (16% VAT, 14-day due term) and six different files'
-- duplicated document-numbering prefixes.
--
-- Public SELECT is required (not just admin) — Homepage.jsx, ProductDetail.jsx,
-- and Step3_Results.jsx read business contact info for anonymous visitors
-- (WhatsApp links, PDF headers) before any login happens.
--
-- mpesa_till_display is deliberately informational-only — real Daraja
-- credentials (shortcode, passkey, consumer key/secret) stay Supabase Edge
-- Function secrets (see supabase/functions/_shared/daraja.ts), not this
-- table. Moving live payment credentials into a client-editable Postgres
-- row would be a real security downgrade; this field is just what's shown
-- to customers on invoices/WhatsApp messages.
--
-- VAT is modeled at TWO levels, matching how KRA actually treats it:
--   1. Per-item (inventory_prices.vat_status below) — every product/BOM
--      component is 'standard' (taxed at vat_rate_pct), 'zero_rated'
--      (taxed at 0%, still technically vatable) or 'exempt' (no VAT,
--      no input VAT claim) — these are genuinely different KRA categories,
--      not just "0% vs not-0%". Defaults to 'standard'; admins reclassify
--      individual items from the Inventory & Prices item form.
--   2. Org-wide pricing mode (vat_pricing_mode below) — whether the prices
--      entered throughout the system (buying_price_kes, and everything
--      derived from it) are already VAT-inclusive (today's behaviour,
--      kept as the default so nothing changes unless explicitly flipped)
--      or VAT-exclusive (tax gets added on top at invoicing time instead
--      of backed out of an inclusive figure). See lib/invoices.js for
--      exactly how each mode changes the invoice math.
-- =========================================================

CREATE TABLE IF NOT EXISTS org_settings (
  id                    INTEGER     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  business_name         TEXT        NOT NULL DEFAULT 'RhiPower Systems',
  whatsapp              TEXT        NOT NULL DEFAULT '+254112839259',
  email                 TEXT        NOT NULL DEFAULT 'jaylinkpowersystems@gmail.com',
  city                  TEXT        NOT NULL DEFAULT 'Nairobi, Kenya',
  tagline               TEXT        NOT NULL DEFAULT 'Smart Solar & Energy Storage Engineering Platform',
  kra_pin               TEXT,
  vat_rate_pct          NUMERIC(5,2) NOT NULL DEFAULT 16,
  vat_pricing_mode      TEXT        NOT NULL DEFAULT 'inclusive' CHECK (vat_pricing_mode IN ('inclusive', 'exclusive')),
  invoice_due_days      INTEGER     NOT NULL DEFAULT 14,
  invoice_prefix        TEXT        NOT NULL DEFAULT 'INV',
  po_prefix             TEXT        NOT NULL DEFAULT 'PO',
  so_prefix             TEXT        NOT NULL DEFAULT 'SO',
  invoice_notes_default TEXT,
  mpesa_till_display    TEXT,
  allow_customer_signup BOOLEAN     NOT NULL DEFAULT true,
  updated_by_email      TEXT
);

INSERT INTO org_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE org_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone_can_read_org_settings"
  ON org_settings FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "admin_can_update_org_settings"
  ON org_settings FOR UPDATE TO authenticated
  USING     (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- ─── Per-item VAT status ─────────────────────────────────────────────────────
ALTER TABLE inventory_prices ADD COLUMN IF NOT EXISTS vat_status TEXT NOT NULL DEFAULT 'standard'
  CHECK (vat_status IN ('standard', 'zero_rated', 'exempt'));

-- ─── DONE ────────────────────────────────────────────────────────────────────
-- After running: a new "Settings" section appears in the admin sidebar for
-- VAT rate + pricing mode + everything else formerly hardcoded, and every
-- item in Inventory & Prices gets a VAT status you can reclassify (defaults
-- to 'standard' — nothing about existing pricing changes until you touch it).
-- Existing hardcoded values (src/config.js's BUSINESS object, 16% VAT,
-- 14-day due term) stay as safe fallbacks until the app code is deployed to
-- read from this table — running this migration alone changes nothing
-- visible until that follow-up frontend deploy lands.

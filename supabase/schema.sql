-- =========================================================
-- RhiPower Systems — Supabase Database Schema v2
-- =========================================================
-- HOW TO USE:
--   1. Log in to supabase.com → open your project → SQL Editor
--   2. Paste this entire file and click "Run"
--   3. All tables and policies will be created automatically
-- =========================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── TABLE 1: Quotation Requests ────────────────────────────────────────────
-- Every time a customer submits the contact form in Step 3, a row appears here.
-- View and manage these from the Supabase Table Editor or the admin dashboard.
CREATE TABLE IF NOT EXISTS quotation_requests (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at      TIMESTAMPTZ DEFAULT NOW(),

  -- Client contact info
  client_name     TEXT        NOT NULL,
  client_phone    TEXT        NOT NULL,
  client_email    TEXT,
  site_address    TEXT,

  -- Client classification (set by the welcome screen)
  client_profile  TEXT        DEFAULT 'homeowner',
  -- 'homeowner' | 'diy' | 'professional' | 'business'

  -- Which path the client chose
  path_selected   TEXT,
  -- 'buy' (supply only) | 'diy' (spec sheet) | 'book' (full turnkey)

  -- Site configuration
  location        TEXT,       -- 'nanyuki', 'nairobi', 'mombasa', etc.
  profile         TEXT,       -- 'airbnb', 'residential', 'farm', etc.
  tier_selected   TEXT,       -- 'premium' | 'balanced' | 'budget'
  backup_days     INTEGER     DEFAULT 1,
  psh             NUMERIC(4,2),  -- Peak Sun Hours from NASA POWER
  psh_source      TEXT,          -- 'nasa' | 'fallback'
  wire_dist_m     INTEGER,       -- Panel-to-inverter cable run (metres)
  site_km         INTEGER,       -- Distance from Nairobi warehouse (km)

  -- System sizing results
  panel_qty       INTEGER,
  inverter_qty    INTEGER,
  battery_qty     INTEGER,
  true_pv_kw      NUMERIC(8,2),
  total_inv_kw    NUMERIC(8,2),
  true_batt_kwh   NUMERIC(8,2),

  -- Financial summary (KES, inclusive of VAT)
  materials_kes   NUMERIC(12,2),
  labor_kes       NUMERIC(12,2),
  logistics_kes   NUMERIC(12,2),
  grand_total_kes NUMERIC(12,2),

  -- Internal pipeline tracking (managed from admin dashboard)
  status          TEXT        DEFAULT 'new',
  -- 'new' → 'contacted' → 'site_surveyed' → 'proposal_accepted' → 'installed' | 'lost'
  assigned_to     TEXT,       -- technician name handling this job
  contacted_at    TIMESTAMPTZ,
  admin_notes     TEXT        -- internal notes — never shown to client
);

-- ─── TABLE 2: Custom Appliance Suggestions ──────────────────────────────────
-- When a customer adds a non-standard appliance that isn't in the master list,
-- it is logged here so you can review and potentially add it to appliances.js
CREATE TABLE IF NOT EXISTS custom_appliance_suggestions (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  name         TEXT        NOT NULL,
  watts        NUMERIC(8,2) NOT NULL,
  surge_factor NUMERIC(3,1) DEFAULT 1.0,
  type         TEXT,        -- 'inductive' | 'resistive'
  times_added  INTEGER      DEFAULT 1
);

-- ─── TABLE 3: Admin Users ────────────────────────────────────────────────────
-- Populated automatically when you log in to the admin dashboard.
-- Do not edit this table manually.
CREATE TABLE IF NOT EXISTS admin_profiles (
  id         UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  full_name  TEXT,
  role       TEXT        DEFAULT 'admin'  -- 'admin' | 'technician'
);

-- ─── INDEXES for fast dashboard queries ─────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_quotations_status   ON quotation_requests(status);
CREATE INDEX IF NOT EXISTS idx_quotations_created  ON quotation_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotations_location ON quotation_requests(location);
CREATE INDEX IF NOT EXISTS idx_quotations_total    ON quotation_requests(grand_total_kes DESC);

-- ─── ROW-LEVEL SECURITY ──────────────────────────────────────────────────────
-- Anonymous visitors can INSERT a quotation but cannot read other people's data.
-- Authenticated admins can read and update everything.
ALTER TABLE quotation_requests           ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_appliance_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_profiles               ENABLE ROW LEVEL SECURITY;

-- Anyone (anonymous) can submit a quotation
CREATE POLICY "anon_can_insert_quote"
  ON quotation_requests FOR INSERT TO anon
  WITH CHECK (true);

-- Authenticated users (admin) can read all quotes
CREATE POLICY "auth_can_read_quotes"
  ON quotation_requests FOR SELECT TO authenticated
  USING (true);

-- Authenticated users (admin) can update status, notes, assigned_to
CREATE POLICY "auth_can_update_quotes"
  ON quotation_requests FOR UPDATE TO authenticated
  USING (true);

-- Anyone can suggest a custom appliance
CREATE POLICY "anon_can_suggest_appliance"
  ON custom_appliance_suggestions FOR INSERT TO anon
  WITH CHECK (true);

-- Admins can read appliance suggestions
CREATE POLICY "auth_can_read_suggestions"
  ON custom_appliance_suggestions FOR SELECT TO authenticated
  USING (true);

-- Admins can read their own profile
CREATE POLICY "auth_can_read_own_profile"
  ON admin_profiles FOR SELECT TO authenticated
  USING (auth.uid() = id);

-- ─── DONE ────────────────────────────────────────────────────────────────────
-- After running, go to Supabase Table Editor to see your tables.
-- quotation_requests is where every client enquiry will appear.

-- =========================================================
-- RhiPower Systems — Supabase Database Schema
-- =========================================================
-- HOW TO USE:
--   1. Log in to supabase.com → open your project → SQL Editor
--   2. Paste this entire file and click "Run"
--   3. All tables will be created automatically
-- =========================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── TABLE 1: Quotation Requests ───────────────────────────────────────────
-- Every time a customer submits the form in Step 3, a row is added here.
-- You can view and filter these from the Supabase dashboard.
CREATE TABLE IF NOT EXISTS quotation_requests (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at      TIMESTAMPTZ DEFAULT NOW(),

  -- Client contact info
  client_name     TEXT NOT NULL,
  client_phone    TEXT NOT NULL,
  client_email    TEXT,
  site_address    TEXT,

  -- Site configuration
  location        TEXT,              -- 'nanyuki', 'nairobi', etc.
  profile         TEXT,              -- 'airbnb', 'residential', etc.
  tier_selected   TEXT,              -- 'premium', 'balanced', 'budget'
  psh             NUMERIC(4,2),      -- Peak Sun Hours from NASA
  psh_source      TEXT,              -- 'nasa' or 'fallback'
  wire_dist_m     INTEGER,
  site_km         INTEGER,

  -- System sizing results
  panel_qty       INTEGER,
  inverter_qty    INTEGER,
  battery_qty     INTEGER,
  true_pv_kw      NUMERIC(8,2),
  total_inv_kw    NUMERIC(8,2),
  true_batt_kwh   NUMERIC(8,2),

  -- Financial summary (in KES)
  materials_kes   NUMERIC(12,2),
  labor_kes       NUMERIC(12,2),
  logistics_kes   NUMERIC(12,2),
  grand_total_kes NUMERIC(12,2),

  -- Internal tracking
  status          TEXT DEFAULT 'new'  -- 'new', 'contacted', 'surveyed', 'sold', 'lost'
);

-- ─── TABLE 2: Custom Appliance Suggestions ─────────────────────────────────
-- When a customer adds a non-standard appliance (unusual machine, specialized
-- industrial load), it gets logged here for you to review and possibly add
-- to the master appliance list.
CREATE TABLE IF NOT EXISTS custom_appliance_suggestions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  name         TEXT NOT NULL,
  watts        NUMERIC(8,2) NOT NULL,
  surge_factor NUMERIC(3,1),
  type         TEXT,          -- 'inductive' or 'resistive'
  times_added  INTEGER DEFAULT 1  -- how many customers have added this item
);

-- ─── INDEXES for fast lookups ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_quotations_status    ON quotation_requests(status);
CREATE INDEX IF NOT EXISTS idx_quotations_created   ON quotation_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotations_location  ON quotation_requests(location);

-- ─── ROW-LEVEL SECURITY ─────────────────────────────────────────────────────
-- Allow anonymous visitors to INSERT (submit a quote request)
-- but NOT read other people's data
ALTER TABLE quotation_requests        ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_appliance_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone can submit a quote"
  ON quotation_requests FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "service role can read all quotes"
  ON quotation_requests FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY "anyone can suggest an appliance"
  ON custom_appliance_suggestions FOR INSERT
  TO anon
  WITH CHECK (true);

-- ─── DONE ──────────────────────────────────────────────────────────────────
-- After running this, go to your Supabase dashboard → Table Editor
-- and you will see quotation_requests and custom_appliance_suggestions tables.

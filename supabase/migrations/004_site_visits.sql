-- =========================================================
-- RhiPower — Site Survey & Installation Tracking
-- =========================================================
-- Structured visit tracking for a lead's pipeline: schedule a site survey,
-- schedule an installation, log who's assigned, notes, GPS, and completion.
-- Scoped deliberately light — RhiPower is a single-admin operation today, so
-- this is admin-managed tracking, not a separate field-technician login/app.
-- If you later hire field staff, `assigned_to` (free text today) is the
-- natural place to grow into a real technician account reference.
-- =========================================================

CREATE TABLE IF NOT EXISTS site_visits (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),

  quotation_id   UUID        NOT NULL REFERENCES quotation_requests(id) ON DELETE CASCADE,

  visit_type     TEXT        NOT NULL,   -- 'survey' | 'installation'
  status         TEXT        NOT NULL DEFAULT 'scheduled',  -- 'scheduled' | 'completed' | 'cancelled'

  scheduled_date DATE,
  completed_date DATE,
  assigned_to    TEXT,       -- free-text technician/crew name + phone for now
  notes          TEXT,
  gps_lat        NUMERIC(9,6),
  gps_lng        NUMERIC(9,6)
);

CREATE INDEX IF NOT EXISTS idx_site_visits_quotation ON site_visits(quotation_id);
CREATE INDEX IF NOT EXISTS idx_site_visits_status    ON site_visits(status);

ALTER TABLE site_visits ENABLE ROW LEVEL SECURITY;

-- Admin-only — this is internal operations detail, not something a customer
-- account needs to query directly (they see the coarse quotation_requests.status)
CREATE POLICY "admin_can_manage_site_visits"
  ON site_visits FOR ALL TO authenticated
  USING     (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- ─── DONE ────────────────────────────────────────────────────────────────────

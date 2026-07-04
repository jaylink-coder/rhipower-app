-- =========================================================
-- RhiPower — Site Visit Photos
-- =========================================================
-- Lets the admin attach photos to a scheduled/completed site visit (survey
-- or installation evidence). Private bucket — photos are internal
-- operational records, viewed via signed URLs, not public links.
-- Independent of 002/003 — depends only on 004_site_visits.sql (site_visits
-- table) and the admin_profiles pattern already used everywhere else.
-- =========================================================

-- ─── 1. Storage bucket ──────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('site-visit-photos', 'site-visit-photos', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
ON CONFLICT (id) DO NOTHING;

-- ─── 2. Photo records ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS site_visit_photos (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  visit_id     UUID        NOT NULL REFERENCES site_visits(id) ON DELETE CASCADE,
  storage_path TEXT        NOT NULL,   -- path inside the site-visit-photos bucket
  caption      TEXT,
  uploaded_by  UUID        REFERENCES admin_profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_site_visit_photos_visit ON site_visit_photos(visit_id);

ALTER TABLE site_visit_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_can_manage_site_visit_photos"
  ON site_visit_photos FOR ALL TO authenticated
  USING     (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- ─── 3. Storage object policies ─────────────────────────────────────────────
-- Admin-only read/write/delete on this bucket. Storage RLS runs against
-- storage.objects, so these policies are separate from the table policy above.
CREATE POLICY "admin_can_read_visit_photos"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'site-visit-photos' AND EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

CREATE POLICY "admin_can_upload_visit_photos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'site-visit-photos' AND EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

CREATE POLICY "admin_can_delete_visit_photos"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'site-visit-photos' AND EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- ─── DONE ────────────────────────────────────────────────────────────────────
-- Verify after running: in /admin, open a lead with a site visit and confirm
-- the photo upload widget appears with no permission errors.

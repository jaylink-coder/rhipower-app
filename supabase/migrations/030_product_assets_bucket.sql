-- =========================================================
-- RhiPower — Product Images + Datasheet Storage
-- =========================================================
-- `inventory_prices.image_url` has existed since migration 008 and is
-- already read by ProductDetail.jsx (with a "Photo coming soon"
-- placeholder) and lib/inventory.js's toProduct() — but nothing has ever
-- written it. This migration adds the storage bucket + policies to close
-- that gap, plus a matching `datasheet_url` for PDF spec sheets.
--
-- Unlike migration 005's site-visit-photos bucket (private, signed URLs,
-- admin-only read — internal operational records), this bucket is PUBLIC:
-- product photos and datasheets need to be visible to anonymous customers
-- browsing the calculator, not just logged-in admins. Write access stays
-- admin-only, same check pattern as every other admin-only policy in this
-- app.
-- =========================================================

-- ─── 1. Storage bucket ──────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('product-assets', 'product-assets', true, 10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- ─── 2. Storage object policies ─────────────────────────────────────────────
-- Public read (anyone can view a product photo/datasheet without logging
-- in — that's the point), admin-only write/delete.
CREATE POLICY "public_can_read_product_assets"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'product-assets');

CREATE POLICY "admin_can_upload_product_assets"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product-assets' AND EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

CREATE POLICY "admin_can_update_product_assets"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'product-assets' AND EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

CREATE POLICY "admin_can_delete_product_assets"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'product-assets' AND EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- ─── 3. Datasheet URL column ─────────────────────────────────────────────────
ALTER TABLE inventory_prices ADD COLUMN IF NOT EXISTS datasheet_url TEXT;

-- ─── DONE ────────────────────────────────────────────────────────────────────
-- After running: the product-assets bucket exists in Storage. Next phase
-- adds the actual upload UI to the Edit Item page.

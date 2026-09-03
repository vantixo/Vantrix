-- ── Ad images storage bucket ──────────────────────────────────────────────
--
-- The admin Ads UI (src/components/admin/ads-manager.tsx) previously offered
-- a "library" of images read straight off disk under public/images
-- (src/app/api/admin/ads/images/route.ts). That only ever lists whatever
-- shipped with the build — an admin could never actually add a new ad
-- creative, only reuse a handful of pre-baked character/marketing images.
-- On top of that, the app's one existing upload bucket ('uploads', see
-- 20240101_production.sql SECTION 17) is PRIVATE and scoped per-user via
-- storage_read_own (auth.uid() folder match) — getPublicUrl() against it
-- returns a URL that 400s for anonymous visitors, so it was never usable
-- for a publicly-rendered ad banner anyway.
--
-- This bucket is the real fix: PUBLIC (so AdBoard, an unauthenticated
-- component, can render it directly), admin-only write, world-readable.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('ad-images', 'ad-images', TRUE, 5242880, ARRAY['image/jpeg','image/png','image/webp','image/gif'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "ad_images_public_read"   ON storage.objects;
DROP POLICY IF EXISTS "ad_images_admin_write"   ON storage.objects;
DROP POLICY IF EXISTS "ad_images_admin_delete"  ON storage.objects;

-- Anyone (including anon) can read — this is what makes the banner render
-- for logged-out visitors on the public discover page.
CREATE POLICY "ad_images_public_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'ad-images');

-- Only admins can upload new creatives.
CREATE POLICY "ad_images_admin_write" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'ad-images' AND is_admin());

-- Only admins can remove creatives.
CREATE POLICY "ad_images_admin_delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'ad-images' AND is_admin());

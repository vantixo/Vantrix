-- ── Fix: avatar uploads never render (uploads bucket is PRIVATE) ────────────
--
-- src/components/profile/avatar-upload.tsx → POST /api/upload → uploads to
-- the 'uploads' bucket → getPublicUrl() → PATCH /api/profile/settings saves
-- that URL as avatar_url. The upload and the save both succeed. The image
-- never loads.
--
-- Root cause: 'uploads' was created with public = FALSE in
-- 20240101_production.sql SECTION 17, scoped read-only to the owner via
-- storage_read_own (auth.uid() folder match). getPublicUrl() always returns
-- a `/storage/v1/object/public/...` URL regardless of the bucket's public
-- flag — but Supabase Storage only actually serves bytes on that endpoint
-- when the bucket itself is public; it does not fall back to evaluating
-- RLS SELECT policies for it. A private bucket's "public" URL 400s for
-- everyone, owner included, no matter what SELECT policies exist.
--
-- This exact failure mode was already diagnosed and fixed once in this
-- codebase — see 20260938_ad_images_bucket.sql's own comment ("getPublicUrl()
-- against it returns a URL that 400s for anonymous visitors") — but that fix
-- created a *new* public bucket ('ad-images') rather than correcting the
-- original 'uploads' bucket, which avatar-upload.tsx (built later) still
-- calls getPublicUrl() against.
--
-- Fix mirrors ad-images exactly: flip the bucket public and replace the
-- owner-only read policy with a public one. Avatars are meant to be visible
-- to other users anyway (account menu, top bar, community/profile surfaces),
-- same as ad creatives — there's no scenario where an avatar needs to be
-- readable only by the uploader. Write/delete stay owner-scoped: nothing
-- about who can *upload to or remove from* their own folder changes.
UPDATE storage.buckets SET public = TRUE WHERE id = 'uploads';

DROP POLICY IF EXISTS "storage_read_own" ON storage.objects;
DROP POLICY IF EXISTS "uploads_public_read" ON storage.objects;
CREATE POLICY "uploads_public_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'uploads');

-- storage_upload_own / storage_delete_own (both already scoped to
-- auth.uid() = (storage.foldername(name))[1]) are untouched — only the
-- bucket's public flag and the read policy change.

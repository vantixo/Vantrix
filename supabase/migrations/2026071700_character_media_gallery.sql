-- Seeded character media: video + gallery support
--
-- characters already has image_url, avatar_url, featured_image_url,
-- reference_images[], canon_sheet_url — all image-only, all pre-existing.
-- This adds:
--   - intro_video_url:  a single hero/intro video for the character
--   - gallery_image_urls[]: additional images beyond the primary avatar,
--     shown in a gallery/carousel (distinct from reference_images, which
--     are LoRA training inputs, not public-facing display media)
--   - gallery_video_urls[]: additional video clips
-- All nullable/empty-default — existing characters are unaffected.
ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS intro_video_url    TEXT,
  ADD COLUMN IF NOT EXISTS gallery_image_urls TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS gallery_video_urls TEXT[] DEFAULT '{}';

COMMENT ON COLUMN characters.intro_video_url    IS 'Single hero/intro video clip for the character profile, uploaded via /api/admin/characters/[id]/media.';
COMMENT ON COLUMN characters.gallery_image_urls IS 'Additional display images beyond avatar_url/image_url — public-facing gallery, not LoRA training data (see reference_images for that).';
COMMENT ON COLUMN characters.gallery_video_urls IS 'Additional video clips for the character gallery/carousel.';

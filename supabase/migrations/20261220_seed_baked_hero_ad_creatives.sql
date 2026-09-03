-- 20261220_seed_baked_hero_ad_creatives.sql
--
-- Adds 5 new hero-position ad banners. Unlike the code:* slides
-- (promo-hero-art.tsx) or the earlier raster hero banners removed by
-- 20261219_remove_legacy_jpg_hero_ads.sql, these 5 images already have
-- their full headline, feature icons, and CTA button designed directly
-- into the image (see public/promos/vantrix-*.jpg) — so HeroAdsCarousel
-- needs to skip its own gradient+title overlay for these rows, or the
-- overlay darkens and duplicates text on top of a CTA that's already
-- baked in. `hide_overlay` (new column, default FALSE so every existing
-- ad row is unaffected) is what the carousel now checks — see this
-- migration's companion change in src/lib/frontend/ads.ts and
-- src/components/home/hero-ads-carousel.tsx.
--
-- Source images were originally 1592x988 PNGs at ~1.7-1.9MB each —
-- resized to 1280px wide and re-encoded as JPEG (~120-165KB each) before
-- being added to public/promos/, in line with the site's existing hero
-- image budget (the old JPG hero banners this replaces ran 200KB-1MB).
-- One duplicate source image (two identical exports of the "Her Voice"
-- voice-calls banner) was deduped — only one row is seeded for it.

ALTER TABLE ads
  ADD COLUMN IF NOT EXISTS hide_overlay BOOLEAN NOT NULL DEFAULT FALSE;

INSERT INTO ads (title, image_url, link, position, active, hide_overlay)
VALUES
  (
    'She Remembers Everything',
    '/promos/vantrix-she-remembers-everything.jpg',
    '/login?mode=sign-up',
    'hero',
    TRUE,
    TRUE
  ),
  (
    'Build Her From Scratch',
    '/promos/vantrix-build-her-from-scratch.jpg',
    '/studio',
    'hero',
    TRUE,
    TRUE
  ),
  (
    'See Her Your Way',
    '/promos/vantrix-see-her-your-way.jpg',
    '/premium',
    'hero',
    TRUE,
    TRUE
  ),
  (
    'Her Voice — Real Voice Calls',
    '/promos/vantrix-her-voice.jpg',
    '/premium',
    'hero',
    TRUE,
    TRUE
  ),
  (
    'Some Doors Are Still Locked',
    '/promos/vantrix-some-doors-locked.jpg',
    '/premium',
    'hero',
    TRUE,
    TRUE
  )
ON CONFLICT (image_url) DO NOTHING;

-- Deactivates the 6 plain text-tagline hero banners seeded by
-- 20261218_seed_code_promo_ads.sql ("Meet Your Characters", "One
-- Universe. Endless Connections.", "Step Into The World", "Your Story.
-- Your Choices.", "Find Your Match", "Create. Evolve. Become Legendary.").
--
-- These render as generic SVG/CSS text-on-gradient slides via
-- promo-hero-art.tsx (image_url = 'code:<slug>') — no photography, no
-- character art, just a headline over the brand gradient. Alongside the
-- 5 fully-designed baked-creative banners from
-- 20261220_seed_baked_hero_ad_creatives.sql (real imagery + baked-in
-- CTA), they read as filler in the same carousel.
--
-- Deactivating rather than deleting (unlike
-- 20261219_remove_legacy_jpg_hero_ads.sql, which deleted its rows): that
-- migration deleted because those rows only existed to point at static
-- files that were being removed at the same time. Here, the design lives
-- in code (promo-hero-art.tsx's slug components), not a deletable asset,
-- so nothing is reclaimed by deleting the row — and `active` is exactly
-- the flag /admin/ads already exposes to bring any one of these back
-- individually without a new migration.
--
-- HeroAdsCarousel (src/components/home/hero-ads-carousel.tsx) only ever
-- renders active position='hero' rows, so this takes effect purely via
-- getHeroAds()'s existing `.eq("active", true)` filter — no frontend
-- change needed.

UPDATE ads
SET active = FALSE
WHERE position = 'hero'
  AND image_url IN (
    'code:meet-your-characters',
    'code:universe-connections',
    'code:step-into-the-world',
    'code:your-story-your-choices',
    'code:find-your-match',
    'code:create-evolve-legendary'
  );

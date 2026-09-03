-- Adds 3 new promo banners to the same `ads` table / seeding pattern as
-- 20260928_seed_hero_promo_ads.sql. Two go to position='hero' (the
-- universe-welcome and dating-perfect-match banners, matching the existing
-- hero rows); the coin/gift banner goes to position='inline' since its
-- content (gifting coins) is a secondary/contextual promo rather than a
-- top-of-page hero, and 'inline' is an existing valid position per the
-- ads table's CHECK constraint — no schema change needed.
--
-- image_url points at static assets bundled in public/promos/, same as
-- the existing two rows.
--
-- IMPORTANT: this comment previously flagged that the `ads` table had no
-- live reader anywhere in the app (the Discover hero pulled from
-- characters.featured_position instead). That gap is now closed:
-- GET /api/ads (src/app/api/ads/route.ts) reads active rows from this
-- table directly, and <AdBoard position="hero" /> — mounted at the top
-- of the Discover page — renders them. These rows are visible to users
-- as soon as this migration is applied and the ad is active.

INSERT INTO ads (title, image_url, link, position, active)
VALUES
  (
    'Welcome to the Vantrix Universe',
    'https://vantrix.ink/promos/vantrix-universe-welcome.png',
    'https://vantrix.ink/universe',
    'hero',
    TRUE
  ),
  (
    'Find Your Perfect Match',
    'https://vantrix.ink/promos/vantrix-dating-perfect-match.png',
    'https://vantrix.ink/dating',
    'hero',
    TRUE
  ),
  (
    'Vantrix Coin — Gift Love, Earn Her Heart',
    'https://vantrix.ink/promos/vantrix-coin-gift-love.png',
    'https://vantrix.ink/premium',
    'inline',
    TRUE
  )
ON CONFLICT (image_url) DO NOTHING;

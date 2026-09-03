-- Adds code-rendered hero banners alongside the existing JPG ones.
-- image_url = 'code:<slug>' tells HeroAdsCarousel (see
-- src/components/home/promo-hero-art.tsx) to render an SVG/CSS banner
-- instead of downloading an image — same gold-on-black brand look as the
-- poster mockups these slugs are based on, at a fraction of the byte size
-- and with zero image-optimization/CDN dependency.
--
-- These target site sections the JPG-only hero never linked to
-- (character gallery, world/lore, roleplay) so the hero carousel now
-- surfaces the app's other pillars, not just signup + pricing.

INSERT INTO ads (title, image_url, link, position, active)
VALUES
  (
    'Meet Your Characters',
    'code:meet-your-characters',
    '/discover',
    'hero',
    TRUE
  ),
  (
    'One Universe. Endless Connections.',
    'code:universe-connections',
    '/world',
    'hero',
    TRUE
  ),
  (
    'Step Into The World',
    'code:step-into-the-world',
    '/world',
    'hero',
    TRUE
  ),
  (
    'Your Story. Your Choices.',
    'code:your-story-your-choices',
    '/discover',
    'hero',
    TRUE
  ),
  (
    'Find Your Match',
    'code:find-your-match',
    '/dating',
    'hero',
    TRUE
  ),
  (
    'Create. Evolve. Become Legendary.',
    'code:create-evolve-legendary',
    '/create-character',
    'hero',
    TRUE
  )
ON CONFLICT (image_url) DO NOTHING;

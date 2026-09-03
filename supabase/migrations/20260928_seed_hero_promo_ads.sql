-- Seeds the Discover hero carousel with the two first-party promo banners
-- (position='hero'). This replaces the character-image-driven hero that
-- previously populated that slot — the hero now only ever shows what's
-- configured here / in /admin/ads, so removing an expired offer or adding
-- a new one is an admin action, not a code change.
--
-- image_url points at static assets bundled in public/promos/ — swap the
-- files or add new rows (and correspondingly new files) as offers change.

INSERT INTO ads (title, image_url, link, position, active)
VALUES
  (
    'Create your own AI Girlfriend',
    'https://vantrix.ink/promos/create-your-own-ai-girlfriend.jpg',
    'https://vantrix.ink/create-character',
    'hero',
    TRUE
  ),
  (
    'Vantrix Hot Summer — 70% off',
    'https://vantrix.ink/promos/vantrix-hot-summer-sale.jpg',
    'https://vantrix.ink/pricing',
    'hero',
    TRUE
  )
ON CONFLICT (image_url) DO NOTHING;

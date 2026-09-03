-- 20261211_promo_ads_png_to_jpg.sql
--
-- The 3 hero promo creatives seeded in 20260930b_seed_additional_promo_ads.sql
-- (and repointed to local /promos/ paths in 20260941_fix_ad_image_urls.sql)
-- were opaque photographic images stored as PNG — a format with no
-- transparency need here, but far less efficient than JPEG for this kind
-- of content (see scripts/optimize-images.mjs run: ~80% smaller after
-- conversion). The files on disk have been re-encoded and renamed from
-- .png to .jpg; this migration is the corresponding data fix so `ads.
-- image_url` still resolves to a file that actually exists.
--
-- Not editing 20260941_fix_ad_image_urls.sql in place: that migration has
-- already run in production, and rewriting applied migrations' history
-- instead of adding a new one is how you get drift between environments
-- that ran it at different times.
UPDATE ads SET image_url = '/promos/vantrix-universe-welcome.jpg'
  WHERE image_url = '/promos/vantrix-universe-welcome.png';
UPDATE ads SET image_url = '/promos/vantrix-dating-perfect-match.jpg'
  WHERE image_url = '/promos/vantrix-dating-perfect-match.png';
UPDATE ads SET image_url = '/promos/vantrix-coin-gift-love.jpg'
  WHERE image_url = '/promos/vantrix-coin-gift-love.png';

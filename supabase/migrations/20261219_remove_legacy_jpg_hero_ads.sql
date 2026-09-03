-- Removes the original JPG hero banners now that the hero carousel is
-- fully served by code-rendered `code:*` slides (see
-- 20261215_seed_code_promo_ads.sql / promo-hero-art.tsx). Deleting rather
-- than deactivating: these rows exist solely to hold a static file path
-- under public/promos/ (create-your-own-ai-girlfriend.jpg,
-- vantrix-hot-summer-sale.jpg, vantrix-universe-welcome.jpg,
-- vantrix-dating-perfect-match.jpg) — there's no future state where
-- flipping `active` back to true is useful without also restoring a
-- since-superseded design, so a soft-disable would just leave dead rows
-- in every future `select * from ads` a maintainer runs.
--
-- vantrix-coin-gift-love.jpg is 'inline' position, not 'hero' — left
-- untouched, this migration only touches the homepage hero slot.
--
-- CORRECTION (applied during merge): the original patch's DELETE still
-- targeted the pre-20261211 .png paths for vantrix-universe-welcome and
-- vantrix-dating-perfect-match. 20261211_promo_ads_png_to_jpg.sql (already
-- applied ahead of this migration) renamed those rows to .jpg, so the
-- .png clauses would have matched zero rows and silently left 2 of the 4
-- legacy hero ads active forever. Fixed to .jpg to match current DB state.

DELETE FROM ads
WHERE position = 'hero'
  AND image_url IN (
    '/promos/create-your-own-ai-girlfriend.jpg',
    '/promos/vantrix-hot-summer-sale.jpg',
    '/promos/vantrix-universe-welcome.jpg',
    '/promos/vantrix-dating-perfect-match.jpg'
  );

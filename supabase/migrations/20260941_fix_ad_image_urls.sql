-- FIX: ads.image_url pointed at bare `vantrix.ink`, but next.config.js only
-- allowlists the `cdn.vantrix.ink` subdomain (and R2/Supabase/etc) for
-- next/image. Every seeded ad (20260928_seed_hero_promo_ads.sql,
-- 20260930b_seed_additional_promo_ads.sql) used the wrong host, so
-- next/image refused to render every single ad creative — the AdBoard
-- component would fetch valid rows from the API but every <Image> in it
-- threw (unconfigured host), so no ad ever rendered. That's why "ads"
-- looked completely broken end-to-end even though the DB/API were fine.
--
-- These files are already bundled locally under /public/promos/, and
-- image_url supports site-relative /public paths (see isSafeLocalImagePath
-- / adCreateSchema in src/app/api/admin/route.ts), so point them there
-- directly instead of at a domain that was never actually serving them.
UPDATE ads SET image_url = '/promos/create-your-own-ai-girlfriend.jpg'
  WHERE image_url = 'https://vantrix.ink/promos/create-your-own-ai-girlfriend.jpg';
UPDATE ads SET image_url = '/promos/vantrix-hot-summer-sale.jpg'
  WHERE image_url = 'https://vantrix.ink/promos/vantrix-hot-summer-sale.jpg';
UPDATE ads SET image_url = '/promos/vantrix-universe-welcome.png'
  WHERE image_url = 'https://vantrix.ink/promos/vantrix-universe-welcome.png';
UPDATE ads SET image_url = '/promos/vantrix-dating-perfect-match.png'
  WHERE image_url = 'https://vantrix.ink/promos/vantrix-dating-perfect-match.png';
UPDATE ads SET image_url = '/promos/vantrix-coin-gift-love.png'
  WHERE image_url = 'https://vantrix.ink/promos/vantrix-coin-gift-love.png';

-- FIX (Phase C audit): 20260928_seed_hero_promo_ads.sql and
-- 20260930b_seed_additional_promo_ads.sql both use
-- `INSERT ... ON CONFLICT DO NOTHING` with no conflict target. Postgres
-- accepts that syntax, but without a unique/exclusion constraint for the
-- inserted columns to violate, there is nothing for a conflict to fire
-- against — so it's not the idempotency guard those migrations' own
-- comments assume. Re-running either file (partial-apply retry, migration
-- replay, CI re-seed) would insert a second, third, ... copy of the same
-- promo banner every time, since `ads.id` is a fresh gen_random_uuid()
-- on every row and never collides with itself.
--
-- A given promo image is only ever meant to back one ad row, so image_url
-- is the natural uniqueness key here (title text also varies less
-- reliably — e.g. an em dash vs hyphen edit would still be "the same ad").
-- This adds that constraint retroactively and de-dupes any rows that
-- already got inserted more than once before this fix landed.

-- De-dupe first: keep the earliest row per image_url, drop the rest.
DELETE FROM ads a
USING ads b
WHERE a.image_url = b.image_url
  AND a.created_at > b.created_at;

CREATE UNIQUE INDEX IF NOT EXISTS ads_image_url_unique ON ads(image_url);

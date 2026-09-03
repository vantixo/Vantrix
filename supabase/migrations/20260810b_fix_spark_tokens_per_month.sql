-- ─────────────────────────────────────────────────────────────────────────────
-- Fix: tiers.tokens_per_month was left at 0 for all three 'spark' billing-
-- length rows by 20260810_single_plan_three_billing_lengths.sql. The actual
-- Vantrix Coin credit users receive on subscribe (100/mo, scaled by billing
-- length — see lib/payments/subscription-tokens.ts + the TOKEN_MONTHS
-- multiplier in every webhook handler) was never wrong, but this column is
-- documented as the single source of truth those files mirror, and it was
-- silently out of sync — anyone querying `tiers` directly would see 0 and
-- wrongly conclude subscribers get no coin. Backfilling it here so the DB
-- and the application code agree.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE tiers SET tokens_per_month = 100  WHERE slug = 'spark';
UPDATE tiers SET tokens_per_month = 300  WHERE slug = 'spark_quarterly';  -- 100/mo × 3
UPDATE tiers SET tokens_per_month = 1200 WHERE slug = 'spark_annual';     -- 100/mo × 12

-- Verify:
--   SELECT slug, billing_interval, tokens_per_month FROM tiers ORDER BY price_usd;

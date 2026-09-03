-- ─────────────────────────────────────────────────────────────────────────────
-- Single-plan pricing: one paid subscription, three billing lengths
--
-- REPLACES the entire prior pricing/discount migration history (tier
-- reconciliations, the 20%/60%/70% annual-discount iterations, the
-- basic/premium/elite tier rows, and the enterprise_annual display row —
-- all deleted). Product no longer sells multiple tiers; the `tiers` table
-- now holds exactly two SELLABLE rows-worth of product: 'free' (still $0,
-- untouched) and one paid plan ('spark' slug kept for compatibility with
-- existing profiles.tier values, Stripe/Paystack metadata, and app code
-- that treats "anything not 'free'" as premium — see normaliseTierForGate()
-- in lib/auth/plan.ts) sold at three lengths:
--
--   1 month   — $9.99/mo    (no discount)
--   3 months  — $6.49/mo    (35% off)  → $19.47 total
--   1 year    — $2.99/mo    (70% off)  → $35.88 total
--
-- price_usd for a monthly row is the per-month charge; for quarterly/annual
-- rows it is the FULL charge for that billing length (matches the existing
-- convention from the deleted 20260716_add_annual_billing.sql).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Widen billing_interval to allow 'quarterly' alongside monthly/annual.
ALTER TABLE tiers DROP CONSTRAINT IF EXISTS tiers_billing_interval_check;
ALTER TABLE tiers
  ALTER COLUMN billing_interval SET DEFAULT 'monthly',
  ADD CONSTRAINT tiers_billing_interval_check
    CHECK (billing_interval IN ('monthly', 'quarterly', 'annual'));

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_billing_interval_check;
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_billing_interval_check
    CHECK (billing_interval IN ('monthly', 'quarterly', 'annual'));

-- paystack_plan_code_quarterly, mirroring the existing _annual column.
ALTER TABLE tiers ADD COLUMN IF NOT EXISTS paystack_plan_code_quarterly TEXT;

-- 2. Remove every paid tier row except the single plan we're keeping
-- ('spark' + its billing-length variants). basic/premium/elite/enterprise
-- and any of their _annual rows no longer exist as sellable products.
DELETE FROM tiers WHERE slug NOT IN ('free', 'spark', 'spark_quarterly', 'spark_annual');

-- 3. Upsert the three billing-length rows for the one paid plan.
INSERT INTO tiers (name, slug, price_usd, price_ngn, price_crypto, features, daily_message_limit, can_create_characters, tokens_per_month, billing_interval, base_tier_slug)
VALUES
  ('Premium — Monthly',   'spark',           9.99,  ROUND(9.99  * 1500), ROUND((9.99  / 62500.0)::numeric, 8), '{}'::jsonb, 2000, true, 100,  'monthly',   'spark'),
  ('Premium — 3 Months',  'spark_quarterly', 19.47, ROUND(19.47 * 1500), ROUND((19.47 / 62500.0)::numeric, 8), '{}'::jsonb, 2000, true, 300,  'quarterly', 'spark'),
  ('Premium — 1 Year',    'spark_annual',    35.88, ROUND(35.88 * 1500), ROUND((35.88 / 62500.0)::numeric, 8), '{}'::jsonb, 2000, true, 1200, 'annual',    'spark')
ON CONFLICT (slug) DO UPDATE SET
  name                = EXCLUDED.name,
  price_usd            = EXCLUDED.price_usd,
  price_ngn            = EXCLUDED.price_ngn,
  price_crypto         = EXCLUDED.price_crypto,
  billing_interval      = EXCLUDED.billing_interval,
  base_tier_slug        = EXCLUDED.base_tier_slug,
  tokens_per_month      = EXCLUDED.tokens_per_month;

COMMENT ON COLUMN tiers.price_usd IS 'Monthly row: per-month charge. Quarterly/annual rows: full charge for that billing length, not a monthly-equivalent (see tiers/config.ts getBillingPlans() for the per-month display figure).';

-- 4. Any profile still carrying a legacy tier value (basic/premium/elite/
-- ultra/enterprise) collapses to 'spark' — the one paid plan now in
-- existence. 'free' and 'spark' pass through unchanged.
UPDATE profiles
SET tier = 'spark'
WHERE tier IS NOT NULL AND tier NOT IN ('free', 'spark');

-- Verify:
--   SELECT slug, billing_interval, price_usd, price_ngn FROM tiers ORDER BY price_usd;

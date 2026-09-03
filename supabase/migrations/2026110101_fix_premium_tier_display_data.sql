-- ─────────────────────────────────────────────────────────────────────────────
-- Fix stale tier display data (features text + daily_message_limit)
--
-- CONTEXT: this is a pure data-correction migration, not a schema change.
-- lib/tiers/limits.ts (the real enforcement source of truth, via
-- checkDailyMessageCap/Redis) already has the correct numbers — free=5
-- messages/day + 1 image/day, premium=2000 messages/day + 300 images/day
-- (ungated in practice, rate-limited not blocked). Nothing about ENFORCEMENT
-- was wrong. What was wrong was the *display* data in this table, read by
-- getPremiumTiers() (lib/frontend/premium.ts) and rendered verbatim as the
-- bullet list on the /premium pricing card (tier-card.tsx: tier.features.map):
--
--   free            features: ["30 messages/day", ...]   -- should be 5, not 30
--   spark           features: ["150 messages/day", ...]  -- should read "unlimited"
--   spark_quarterly features: []                          -- empty — nothing rendered
--   spark_annual    features: ["150 messages/day", ...]  -- should read "unlimited"
--
-- daily_message_limit (not currently rendered anywhere in the UI — grep
-- confirms only getPremiumTiers() selects it — but still misleading at-rest
-- metadata that the next feature built against this table would silently
-- inherit) was similarly inconsistent: free=30, spark=150, spark_quarterly=
-- 2000, spark_annual=150. Normalized to match TIER_LIMITS in
-- lib/tiers/limits.ts: free=5, all three premium billing lengths=2000.
--
-- base_tier_slug is untouched here — 20260937_backfill_legacy_tier_slugs.sql
-- already correctly set it to 'premium' for all paid rows; the bug that made
-- it LOOK broken was an app-code bug (getPremiumBillingOptions call site
-- keying off `slug` instead of `base_tier_slug`), fixed separately in
-- lib/frontend/premium.ts and premium/page.tsx, not here.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE tiers
SET features = ARRAY['5 messages per day', '1 image generation per day'],
    daily_message_limit = 5
WHERE slug = 'free';

UPDATE tiers
SET features = ARRAY['Unlimited messages — rate-limited, not gated', 'Unlimited image generation — rate-limited, not gated'],
    daily_message_limit = 2000
WHERE slug IN ('spark', 'spark_quarterly', 'spark_annual');

-- Verify:
--   SELECT slug, features, daily_message_limit FROM tiers ORDER BY price_usd;
--   -- Expect: free -> 5, all three spark* rows -> 2000, features populated
--   -- and consistent across all three premium billing lengths.
-- ─────────────────────────────────────────────────────────────────────────────

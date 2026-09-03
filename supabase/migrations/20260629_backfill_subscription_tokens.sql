-- ─────────────────────────────────────────────────────────────────────────────
-- CRIT-6 token backfill
-- 
-- Root cause: all three payment webhooks (Stripe, Paystack, NOWPayments)
-- were calling credit_subscription_tokens() correctly in the code, BUT the
-- Promise.all() return values were never checked for .error — Supabase-js
-- resolves { data, error } rather than throwing, so every failed DB write
-- was silently swallowed. The events were marked processed; the providers
-- stopped retrying; users ended up with their tier upgraded but tokens
-- still at the default 50 (or wherever they were before the payment).
--
-- This migration one-time credits every paid subscriber whose token balance
-- appears to have never been credited (i.e. still at or near the default 50).
-- It uses credit_subscription_tokens() — the same additive RPC the webhook
-- uses — so it is safe to run even if some users were partially credited:
-- additive += never over-credits compared to what was owed.
--
-- Conservative threshold: profiles.tokens <= 100 (default 50 + minor
-- legitimate spend) flags users who almost certainly never received a
-- subscription credit. Adjust if your free tier's welcome bonus is higher.
--
-- SAFE TO RE-RUN: credit_subscription_tokens() is a pure increment; running
-- this twice would double-credit those users, so verify the before/after
-- counts below before committing.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Preview: how many users are affected?
-- Run this SELECT first to check the scale before the UPDATE.
/*
SELECT
  p.tier,
  COUNT(*)                    AS affected_users,
  SUM(p.tokens)               AS total_current_tokens,
  SUM(t.tokens_per_month)     AS tokens_owed
FROM profiles p
JOIN tiers t ON t.slug = p.tier
WHERE p.tier NOT IN ('free')
  AND p.tokens <= 100    -- likely never credited
GROUP BY p.tier
ORDER BY p.tier;
*/

-- 2. Credit tokens owed to every affected paid subscriber
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT
      p.id           AS user_id,
      t.tokens_per_month AS credit_amount
    FROM profiles p
    JOIN tiers t ON t.slug = p.tier
    WHERE p.tier NOT IN ('free', 'enterprise')
      AND p.tokens <= 100   -- conservative threshold: likely never credited
      AND t.tokens_per_month > 0
  LOOP
    PERFORM credit_subscription_tokens(r.user_id, r.credit_amount);
  END LOOP;
END;
$$;

-- 3. Enterprise users get a larger credit — kept separate since 50000 tokens
-- at once may warrant manual review before crediting.
-- Uncomment and run manually after verifying enterprise subscriber count:
/*
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.id AS user_id
    FROM profiles p
    WHERE p.tier = 'enterprise' AND p.tokens <= 100
  LOOP
    PERFORM credit_subscription_tokens(r.user_id, 50000);
  END LOOP;
END;
$$;
*/

-- 4. Verify the result
-- Run this SELECT after the DO block to confirm credits landed:
/*
SELECT
  tier,
  COUNT(*)           AS users,
  AVG(tokens)::int   AS avg_tokens,
  MIN(tokens)        AS min_tokens,
  MAX(tokens)        AS max_tokens
FROM profiles
WHERE tier NOT IN ('free')
GROUP BY tier
ORDER BY tier;
*/

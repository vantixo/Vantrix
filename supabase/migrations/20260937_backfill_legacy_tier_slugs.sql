-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill legacy tier slugs -> two-tier model ('free' | 'premium')
--
-- CONTEXT: app code (lib/tiers/limits.ts, lib/auth/plan.ts, and every payment
-- webhook handler) has moved to a strict two-tier model where the only real
-- tiers are 'free' and 'premium'. Several DB columns still allow, and in
-- live rows still hold, the older multi-tier vocabulary
-- (spark/basic/elite/enterprise/ultra) from before that model existed:
--
--   profiles.tier              — CHECK ('free','spark','basic','premium','elite','enterprise')
--   characters.min_tier        — CHECK ('free','spark','basic','premium','elite','enterprise')
--   character_content.min_tier — CHECK ('free','spark','basic','premium','elite','enterprise')
--   subscriptions.tier         — plain TEXT, no CHECK
--   tiers.base_tier_slug       — the slug embedded in Stripe/Paystack/NOWPayments
--                                 metadata at checkout time and read back by
--                                 every webhook handler; still 'spark' as of
--                                 20260810_single_plan_three_billing_lengths.sql
--
-- App code already tolerates legacy values defensively at the read side
-- (normaliseTierForGate() and similar treat "anything not 'free'" as
-- premium) so nothing is currently broken — but several places display the
-- raw string to users (e.g. usage-hud.tsx's tier badge used to render
-- "elite" literally) or do exact-string comparisons against 'spark'
-- specifically (payment webhook handlers, planCodeForTier()) with
-- transitional fallback logic that this migration lets us delete
-- afterward.
--
-- NOT touched here, deliberately:
--   - dating_matches.match_tier ('spark'/'flame'/'deep'/'soulmate') — a
--     completely separate concept (relationship progression tier), not a
--     billing tier. Sharing the word "spark" with the old billing tier is
--     coincidental; renaming this would break the dating feature for no
--     reason.
--   - tiers.slug ('spark'/'spark_quarterly'/'spark_annual') — the catalog
--     row's own identifier, potentially referenced by URL/query-param code
--     or cached client state outside this codebase. Only base_tier_slug
--     (the feature-gating value written to profiles.tier) is renamed below.
--     Revisit slug separately if desired.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Backfill data — every legacy non-free value collapses to 'premium'.
--    Plain UPDATEs keyed on NOT IN ('free','premium'), idempotent/safe to
--    re-run.

UPDATE profiles
SET tier = 'premium'
WHERE tier IS NOT NULL AND tier NOT IN ('free', 'premium');

UPDATE characters
SET min_tier = 'premium'
WHERE min_tier IS NOT NULL AND min_tier NOT IN ('free', 'premium');

UPDATE character_content
SET min_tier = 'premium'
WHERE min_tier IS NOT NULL AND min_tier NOT IN ('free', 'premium');

UPDATE subscriptions
SET tier = 'premium'
WHERE tier IS NOT NULL AND tier NOT IN ('free', 'premium');

UPDATE tiers
SET base_tier_slug = 'premium'
WHERE base_tier_slug IS NOT NULL AND base_tier_slug NOT IN ('free', 'premium');

-- 2. Tighten CHECK constraints now that the data satisfies them. Postgres'
--    default constraint-naming convention (<table>_<column>_check) matches
--    what 20240101_production.sql's inline CHECKs would have generated.

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_tier_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_tier_check CHECK (tier IN ('free', 'premium'));

ALTER TABLE characters DROP CONSTRAINT IF EXISTS characters_min_tier_check;
ALTER TABLE characters
  ADD CONSTRAINT characters_min_tier_check CHECK (min_tier IN ('free', 'premium'));

ALTER TABLE character_content DROP CONSTRAINT IF EXISTS character_content_min_tier_check;
ALTER TABLE character_content
  ADD CONSTRAINT character_content_min_tier_check CHECK (min_tier IN ('free', 'premium'));

-- 3. Update trigger functions that generate/validate tier values, so new
--    rows can't reintroduce the legacy vocabulary this migration just
--    cleaned up.

-- trg_fn_tier_badge (20240101_production.sql): drove profiles.tier_badge_colour
-- off a 6-way CASE. Collapse to the two real values, keep the same grey
-- default as the old ELSE branch for safety.
CREATE OR REPLACE FUNCTION trg_fn_tier_badge()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.tier_badge_colour := CASE NEW.tier
    WHEN 'free'    THEN '#6b7280'
    WHEN 'premium' THEN '#8b5cf6'
    ELSE '#6b7280'
  END;
  NEW.show_ads := (NEW.tier = 'free');
  RETURN NEW;
END;
$$;

-- sync_character_tier_premium_flag (20260919_fix_archive_of_echoes_min_tier.sql):
-- previously bumped a newly-flagged-premium character with no min_tier set
-- to the legacy 'spark' floor. Under the two-tier model there's only one
-- non-free floor to bump it to.
CREATE OR REPLACE FUNCTION sync_character_tier_premium_flag()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.is_premium = true AND NEW.min_tier = 'free' THEN
    NEW.min_tier := 'premium';
  END IF;

  IF NEW.min_tier <> 'free' AND NEW.is_premium = false THEN
    NEW.is_premium := true;
  END IF;

  RETURN NEW;
END;
$$;

-- 4. NOT updated, and why: can_send_message()'s v_limit_key lookup
-- (v_profile.tier || '_daily_messages' against app_config) is DB-side
-- legacy gating that predates lib/tiers/limits.ts becoming the single
-- source of truth (see that file's header comment) and is not called
-- anywhere in current app code (grep confirms only increment_daily_messages
-- is invoked via RPC; can_send_message only appears in the generated
-- supabase.ts types). Backfilling profiles.tier to 'premium' silently
-- changes what this dead function *would* return (app_config already has a
-- 'premium_daily_messages' = 2500 row, vs. the 'spark_daily_messages' = 300
-- row it used to resolve to) if anything ever calls it again. Flagging
-- rather than fixing since touching unused DB functions in this migration
-- risks masking the real question — whether can_send_message should be
-- dropped entirely now that Redis-based rate-limit/index.ts + tiers/limits.ts
-- are the real enforcement path.

-- Verify:
--   SELECT tier, COUNT(*) FROM profiles GROUP BY tier;
--   SELECT min_tier, COUNT(*) FROM characters GROUP BY min_tier;
--   SELECT min_tier, COUNT(*) FROM character_content GROUP BY min_tier;
--   SELECT tier, COUNT(*) FROM subscriptions GROUP BY tier;
--   SELECT slug, base_tier_slug FROM tiers ORDER BY price_usd;
-- ─────────────────────────────────────────────────────────────────────────────

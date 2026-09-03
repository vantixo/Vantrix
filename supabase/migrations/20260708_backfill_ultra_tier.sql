-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill legacy 'ultra' tier values to 'elite'
--
-- 'ultra' was the deprecated v1 name for what's now called 'elite'. The
-- Stripe webhook (app/api/payments/stripe/webhook/route.ts) normalizes this
-- alias on every NEW billing event it processes, but that only fixes a
-- user's row the next time their subscription generates an event (renewal,
-- upgrade, etc.) — it never retroactively touches existing rows.
--
-- Until this runs, any profile whose tier column still literally says
-- 'ultra' is ranked by TIER_RANK (lib/auth/plan.ts) as premium-equivalent
-- rather than elite-equivalent (see that file's prior fix), silently
-- denying elite-gated features to legacy subscribers who are otherwise
-- unaffected — a data problem, not a logic problem, so it needs a data fix.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE profiles
   SET tier = 'elite'
 WHERE tier = 'ultra';

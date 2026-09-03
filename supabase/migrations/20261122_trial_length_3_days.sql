-- ════════════════════════════════════════════════════════════════════════════
-- Shorten Premium Free Trial: 7 days → 3 days
--
-- activate_trial() (see 20240700_free_trial.sql) hard-coded the trial length
-- as INTERVAL '7 days' directly in the function body. That's the actual
-- server-side authority for how long a trial lasts — the app-layer constant
-- (PREMIUM_TRIAL_DAYS in @/lib/tiers/limits.ts) and the Stripe Checkout
-- session's trial_period_days are both just callers/consumers of this value
-- and were already updated to 3 in the same change; this migration is what
-- makes the database agree with them.
--
-- CREATE OR REPLACE, not a fresh migration editing history in place — the
-- original 20240700 migration is left untouched (never edit applied
-- migrations; see scripts/verify-migrations.sh). This migration only
-- changes the interval; guard clause, idempotency check, and return value
-- are unchanged from the original.
--
-- Safe to run multiple times.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION activate_trial(
  p_user_id            UUID,
  p_stripe_customer_id TEXT DEFAULT NULL,
  p_stripe_sub_id      TEXT DEFAULT NULL
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trial_end TIMESTAMPTZ := NOW() + INTERVAL '3 days';
BEGIN
  -- Guard: silently skip if trial already used (idempotency)
  IF EXISTS (
    SELECT 1 FROM profiles WHERE id = p_user_id AND trial_used = TRUE
  ) THEN
    RETURN (SELECT trial_ends_at FROM profiles WHERE id = p_user_id);
  END IF;

  UPDATE profiles
  SET
    tier               = 'spark',
    trial_ends_at      = v_trial_end,
    trial_used         = TRUE,
    stripe_customer_id = COALESCE(p_stripe_customer_id, stripe_customer_id),
    stripe_sub_id      = COALESCE(p_stripe_sub_id, stripe_sub_id),
    updated_at         = NOW()
  WHERE id = p_user_id;

  RETURN v_trial_end;
END;
$$;

GRANT EXECUTE ON FUNCTION activate_trial(UUID, TEXT, TEXT) TO service_role;

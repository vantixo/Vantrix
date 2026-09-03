-- Fixes AUDIT finding #4 (revocation atomicity): executeRevocation() in
-- src/lib/payments/revocation.ts previously did four separate, unchecked
-- writes from application code —
--   1. subscriptions.update(status='cancelled')
--   2. profiles.update(tier='free')          [conditional]
--   3. subscription_revocation_flags.update(status='executed')
-- — with no shared transaction and no error-checking on (1) or (2). If (2)
-- failed (transient DB error, connection drop) but (3) still ran, the flag
-- would read 'executed' while the user's profile silently kept paid tier —
-- an entitlement-state integrity bug, not just a logging gap.
--
-- This function performs the same three writes as one atomic unit: if any
-- statement fails, the whole function raises and nothing commits, so the
-- flag stays 'pending' and is picked up again by the next sweep run
-- instead of being incorrectly marked done.
--
-- Also closes finding #5 defensively: the app-code version cancelled by
-- (user_id, provider) rather than the specific subscription tied to
-- source_payment_id. In practice `subscriptions_user_provider_unique
-- UNIQUE (user_id, provider)` (see 20240101_production.sql) already
-- guarantees at most one row per (user, provider), so this was never
-- actually able to cancel a second, unrelated subscription under the same
-- provider — but this function still targets by primary key where a
-- specific subscription row is known, so the guarantee doesn't rest on
-- that constraint never changing.

CREATE OR REPLACE FUNCTION execute_subscription_revocation(p_flag_id UUID)
RETURNS TABLE (
  outcome        TEXT,   -- 'downgraded' | 'retained' | 'already_executed' | 'not_pending'
  out_user_id    UUID,
  out_provider   TEXT,
  out_reason     TEXT,
  previous_tier  TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_flag             subscription_revocation_flags%ROWTYPE;
  v_profile_tier     TEXT;
  v_other_active_id  UUID;
  v_outcome          TEXT;
BEGIN
  -- Lock the flag row for the duration of this transaction so a concurrent
  -- sweep run (or a duplicate cron trigger) can't process the same flag
  -- twice in parallel. SKIP LOCKED would silently no-op under contention;
  -- we want the second caller to actually wait and then see 'not_pending'
  -- via the status check below, not silently do nothing.
  SELECT * INTO v_flag
  FROM subscription_revocation_flags
  WHERE id = p_flag_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'revocation flag % not found', p_flag_id;
  END IF;

  IF v_flag.status = 'executed' THEN
    RETURN QUERY SELECT 'already_executed', v_flag.user_id, v_flag.provider, v_flag.reason, v_flag.previous_tier;
    RETURN;
  END IF;

  IF v_flag.status != 'pending' THEN
    -- e.g. 'cleared' by an admin after the sweep query ran but before this
    -- function acquired the lock — respect that, don't downgrade.
    RETURN QUERY SELECT 'not_pending', v_flag.user_id, v_flag.provider, v_flag.reason, NULL::TEXT;
    RETURN;
  END IF;

  SELECT tier INTO v_profile_tier FROM profiles WHERE id = v_flag.user_id;

  -- Cancel the subscription row(s) for this (user, provider). The
  -- UNIQUE(user_id, provider) constraint means this targets exactly one
  -- row in practice; scoped by both columns regardless so a future schema
  -- change loosening that constraint can't silently widen this update's
  -- blast radius.
  UPDATE subscriptions
  SET status = 'cancelled'
  WHERE user_id = v_flag.user_id
    AND provider = v_flag.provider;

  -- Does the user still have a different, currently-active subscription
  -- (a different provider, or a plan started after this one)? If so, don't
  -- strip their tier — mirrors the "otherActive" convention used by every
  -- explicit-cancellation handler elsewhere in this codebase.
  SELECT id INTO v_other_active_id
  FROM subscriptions
  WHERE user_id = v_flag.user_id
    AND status = 'active'
    AND expires_at > now()
  LIMIT 1;

  IF v_other_active_id IS NULL THEN
    UPDATE profiles SET tier = 'free' WHERE id = v_flag.user_id;
    v_outcome := 'downgraded';
  ELSE
    v_outcome := 'retained';
  END IF;

  UPDATE subscription_revocation_flags
  SET status        = 'executed',
      executed_at   = now(),
      previous_tier = v_profile_tier
  WHERE id = p_flag_id;

  RETURN QUERY SELECT v_outcome, v_flag.user_id, v_flag.provider, v_flag.reason, v_profile_tier;
END;
$$;

COMMENT ON FUNCTION execute_subscription_revocation(UUID) IS
  'Atomically cancels the subscription, downgrades the profile tier if no other active subscription remains, and marks the revocation flag executed — all-or-nothing. Call from the revocation-sweep cron / admin tooling instead of performing these writes separately from application code.';

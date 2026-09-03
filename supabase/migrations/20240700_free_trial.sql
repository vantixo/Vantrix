-- ════════════════════════════════════════════════════════════════════════════
-- Free Trial Feature — Database Layer
--
-- Adds the three profile columns required by the trial system, creates the
-- activate_trial() and expire_trials() RPC functions, and registers an index
-- so the expire cron stays fast even at millions of rows.
--
-- Safe to run multiple times (all statements are IF NOT EXISTS / OR REPLACE).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Profile columns ────────────────────────────────────────────────────────

-- When the Spark free trial ends (NULL = never started or already expired).
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;

-- TRUE once any trial was ever activated — blocks re-trial (defence in depth;
-- the API route also checks this, so it's doubly enforced).
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS trial_used BOOLEAN NOT NULL DEFAULT FALSE;

-- Stripe subscription ID stored at trial activation so webhook.subscription.deleted
-- can identify which user to downgrade even without a payment amount.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS stripe_sub_id TEXT;

-- ── 2. Indexes ────────────────────────────────────────────────────────────────

-- expire_trials() scans WHERE trial_ends_at < NOW() AND tier = 'spark'; this
-- index keeps that scan O(log n) regardless of table size.
CREATE INDEX IF NOT EXISTS idx_profiles_trial_ends_at
  ON profiles (trial_ends_at)
  WHERE trial_ends_at IS NOT NULL;

-- ── 3. activate_trial() ───────────────────────────────────────────────────────
-- Called by the Stripe webhook (checkout.session.completed, is_trial='true').
-- Atomic: sets tier='spark', trial_ends_at=now+7d, trial_used=true in one row
-- update so no partial state is possible.
-- Idempotent: if the user somehow triggers the webhook twice, the second call
-- is a no-op (trial_used guard).
-- Returns the trial_ends_at that was set (useful for the webhook log line).

CREATE OR REPLACE FUNCTION activate_trial(
  p_user_id            UUID,
  p_stripe_customer_id TEXT DEFAULT NULL,
  p_stripe_sub_id      TEXT DEFAULT NULL
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_trial_end TIMESTAMPTZ := NOW() + INTERVAL '7 days';
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

-- ── 4. expire_trials() ────────────────────────────────────────────────────────
-- Called by the daily-reset cron at 00:00 UTC.
-- Finds all Spark users whose trial_ends_at has passed and downgrades them
-- to free. Returns the count of rows affected.
-- Note: does NOT reset trial_used — once used, the flag stays TRUE forever.

CREATE OR REPLACE FUNCTION expire_trials()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE profiles
  SET
    tier          = 'free',
    trial_ends_at = NULL,
    updated_at    = NOW()
  WHERE
    tier          = 'spark'
    AND trial_used = TRUE
    AND trial_ends_at IS NOT NULL
    AND trial_ends_at < NOW();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ── 5. Grant execute to service role ─────────────────────────────────────────
-- supabaseAdmin uses the service role; these grants ensure the RPCs are
-- callable from the backend without further permission escalation.

GRANT EXECUTE ON FUNCTION activate_trial(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION expire_trials()                   TO service_role;

-- 20260902_expire_subscriptions_return_counts.sql
--
-- expire_subscriptions() (defined in 20240101_production.sql) already
-- implements the correct expiry algorithm: expire past-due active
-- subscriptions, then downgrade a user to 'free' only if they have no
-- OTHER active, non-expired subscription (covers users with two providers,
-- or a newer subscription from the same provider already active).
--
-- It RETURNS VOID, so the daily-reset cron (src/app/api/cron/daily-reset/
-- route.ts) had no way to log/report what happened without re-querying —
-- which is exactly why that route was never switched over to it and instead
-- carried its own duplicate, unpaginated-correctly, hand-rolled expiry loop.
--
-- This migration CREATE OR REPLACEs the same function (same name, same
-- SECURITY DEFINER semantics) to additionally return the counts, with no
-- change to its expiry logic.

CREATE OR REPLACE FUNCTION expire_subscriptions()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_expired    INTEGER;
  v_downgraded INTEGER;
BEGIN
  UPDATE subscriptions SET status = 'expired'
  WHERE expires_at < NOW() AND status = 'active';
  GET DIAGNOSTICS v_expired = ROW_COUNT;

  UPDATE profiles SET tier = 'free'
  WHERE id IN (
    SELECT DISTINCT user_id FROM subscriptions WHERE expires_at < NOW() AND status = 'expired'
  )
  AND id NOT IN (
    SELECT DISTINCT user_id FROM subscriptions WHERE status = 'active' AND expires_at > NOW()
  )
  AND tier != 'free';
  GET DIAGNOSTICS v_downgraded = ROW_COUNT;

  RETURN jsonb_build_object('expired', v_expired, 'downgraded', v_downgraded);
END;
$$;

-- Same grants as the original definition (20240101_production.sql,
-- 20261121_security_definer_privilege_lockdown.sql) — CREATE OR REPLACE
-- does not touch grants, but re-asserting them here keeps this migration
-- self-contained if it's ever the first place someone reads the function.
REVOKE EXECUTE ON FUNCTION expire_subscriptions() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION expire_subscriptions() TO service_role;

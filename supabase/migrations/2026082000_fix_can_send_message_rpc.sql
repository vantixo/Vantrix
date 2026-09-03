-- ═══════════════════════════════════════════════════════════════════════
-- P0 fix: 20261026_fix_identity_bearing_rpcs.sql closed 6 of the 7
-- privileged identity-bearing RPCs flagged in the production audit, but
-- can_send_message(p_user_id UUID) was left out of that migration. It
-- accepts a caller-controlled p_user_id, is still GRANTed to
-- `authenticated` (see 20240101_production.sql), and its body never
-- checked auth.uid() — so any logged-in browser client could call:
--
--   supabase.rpc('can_send_message', { p_user_id: '<victim>' })
--
-- and burn another user's daily_messages_used quota under elevated
-- privilege, since the function increments that counter as a side
-- effect of the check itself.
--
-- Audit confirms this RPC currently has NO application caller at all
-- (only appears in the generated types file) — chat/stream and friends
-- enforce message limits through a different path. That makes this a
-- live, currently-dead-but-still-callable attack surface rather than a
-- functional regression risk to fix.
--
-- Fix (same defense-in-depth pattern as 20261026):
--   1. Re-create the function (body unchanged) with an added
--      auth.uid() = p_user_id guard.
--   2. REVOKE EXECUTE from anon/authenticated/PUBLIC, leaving only
--      service_role — consistent with every other identity-bearing RPC.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION can_send_message(p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_profile   profiles%ROWTYPE;
  v_limit_key TEXT;
  v_limit     INTEGER;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'unauthorized: cannot act on behalf of another user';
  END IF;

  SELECT * INTO v_profile FROM profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'no_profile');
  END IF;
  IF v_profile.is_disabled THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'account_disabled');
  END IF;
  IF v_profile.daily_reset_at < CURRENT_DATE THEN
    UPDATE profiles SET daily_messages_used = 0, daily_reset_at = CURRENT_DATE WHERE id = p_user_id;
    v_profile.daily_messages_used := 0;
  END IF;
  v_limit_key := v_profile.tier || '_daily_messages';
  SELECT value::INTEGER INTO v_limit FROM app_config WHERE key = v_limit_key;
  v_limit := COALESCE(v_limit, 75);
  IF v_profile.daily_messages_used >= v_limit THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'daily_limit', 'limit', v_limit, 'used', v_profile.daily_messages_used);
  END IF;
  UPDATE profiles SET daily_messages_used = daily_messages_used + 1, last_active_at = NOW() WHERE id = p_user_id;
  RETURN jsonb_build_object('allowed', true, 'used', v_profile.daily_messages_used + 1, 'limit', v_limit);
END;
$$;

ALTER FUNCTION public.can_send_message(uuid) SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION can_send_message(UUID) FROM authenticated, anon, PUBLIC;

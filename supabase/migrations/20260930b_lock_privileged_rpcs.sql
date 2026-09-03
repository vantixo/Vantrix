-- ═══════════════════════════════════════════════════════════════════════
-- P0 fix: privileged RPCs are directly callable by any authenticated
-- browser client via PostgREST, and every one of them accepts a
-- caller-controlled user_id / match_id / session_id.
--
-- e.g. today, from any logged-in browser:
--   supabase.rpc('deduct_tokens', { user_id: '<victim>', amount: 999999 })
-- succeeds, because these functions were GRANTed to `authenticated` and
-- never check auth.uid() against the id argument.
--
-- Audit confirms every server-side caller of these already goes through
-- `supabaseAdmin` (service_role) after resolving the acting user from
-- their session (see src/app/api/**). So nothing legitimate calls these
-- directly from the browser client — safe to revoke.
--
-- Fix: revoke EXECUTE from anon/authenticated, leave service_role only.
-- Internal SECURITY DEFINER-to-SECURITY DEFINER calls (e.g. send_gift ->
-- deduct_tokens, complete_date_session -> update_bond_score) are made by
-- the function owner, not the original caller's role, so revoking
-- `authenticated` does not break those call chains.
-- ═══════════════════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION deduct_tokens(UUID, INTEGER)                                    FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION increment_xp(UUID, INTEGER, TEXT)                               FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION update_psychology(UUID, UUID, TEXT)                             FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION apply_personality_drift(UUID, UUID, NUMERIC, NUMERIC, NUMERIC)  FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION check_and_update_streak(UUID)                                   FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION increment_daily_messages(UUID)                                  FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION get_or_create_daily_quests(UUID, DATE, JSONB)                   FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION progress_daily_quest(UUID, DATE, TEXT, INTEGER)                 FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION consume_streak_shield(UUID, INTEGER)                            FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION update_bond_score(UUID, INTEGER)                                FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION send_gift(UUID, UUID, UUID, TEXT, TEXT, INTEGER, INTEGER, TEXT)  FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION start_date_session(UUID, UUID, UUID, TEXT, TEXT, INTEGER, INTEGER, UUID) FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION complete_date_session(UUID, UUID)                               FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION mark_all_notifications_read(UUID)                               FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION update_dating_streak(UUID)                                      FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION spend_tokens(UUID, INTEGER)                                      FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION credit_subscription_tokens(UUID, INTEGER)                       FROM authenticated, anon, PUBLIC;

GRANT EXECUTE ON FUNCTION deduct_tokens(UUID, INTEGER)                                    TO service_role;
GRANT EXECUTE ON FUNCTION increment_xp(UUID, INTEGER, TEXT)                               TO service_role;
GRANT EXECUTE ON FUNCTION update_psychology(UUID, UUID, TEXT)                             TO service_role;
GRANT EXECUTE ON FUNCTION apply_personality_drift(UUID, UUID, NUMERIC, NUMERIC, NUMERIC)  TO service_role;
GRANT EXECUTE ON FUNCTION check_and_update_streak(UUID)                                   TO service_role;
GRANT EXECUTE ON FUNCTION increment_daily_messages(UUID)                                  TO service_role;
GRANT EXECUTE ON FUNCTION get_or_create_daily_quests(UUID, DATE, JSONB)                   TO service_role;
GRANT EXECUTE ON FUNCTION progress_daily_quest(UUID, DATE, TEXT, INTEGER)                 TO service_role;
GRANT EXECUTE ON FUNCTION consume_streak_shield(UUID, INTEGER)                            TO service_role;
GRANT EXECUTE ON FUNCTION update_bond_score(UUID, INTEGER)                                TO service_role;
GRANT EXECUTE ON FUNCTION send_gift(UUID, UUID, UUID, TEXT, TEXT, INTEGER, INTEGER, TEXT)  TO service_role;
GRANT EXECUTE ON FUNCTION start_date_session(UUID, UUID, UUID, TEXT, TEXT, INTEGER, INTEGER, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION complete_date_session(UUID, UUID)                               TO service_role;
GRANT EXECUTE ON FUNCTION mark_all_notifications_read(UUID)                               TO service_role;
GRANT EXECUTE ON FUNCTION update_dating_streak(UUID)                                      TO service_role;
GRANT EXECUTE ON FUNCTION spend_tokens(UUID, INTEGER)                                      TO service_role;
GRANT EXECUTE ON FUNCTION credit_subscription_tokens(UUID, INTEGER)                       TO service_role;

-- ── Belt-and-suspenders: harden deduct_tokens itself against negative
-- amounts. Since this is now service_role-only, only trusted server code
-- can reach it, but the audit specifically flagged that deduct_tokens
-- accepts negative amounts as an implicit credit path (deduct_tokens(u, -100)
-- == credit). Reject that at the function level too, so a bug in server
-- code can't silently mint tokens. Refunds/credits must use add_tokens().
CREATE OR REPLACE FUNCTION deduct_tokens(user_id UUID, amount INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_tokens INTEGER;
BEGIN
  IF amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount'
      USING HINT = 'deduct_tokens requires a positive amount; use add_tokens() for credits/refunds';
  END IF;

  UPDATE profiles
  SET tokens = tokens - amount
  WHERE id = user_id AND tokens >= amount
  RETURNING tokens INTO v_tokens;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'insufficient_tokens'
      USING HINT = 'User does not have enough tokens';
  END IF;

  RETURN v_tokens;
END;
$$;

GRANT EXECUTE ON FUNCTION deduct_tokens(UUID, INTEGER) TO service_role;

-- add_tokens already positive-only via GREATEST(0, ...) and service_role-only;
-- also reject negative/zero explicitly so silent no-ops don't mask bugs.
CREATE OR REPLACE FUNCTION add_tokens(p_user_id UUID, p_amount INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount'
      USING HINT = 'add_tokens requires a positive amount';
  END IF;
  UPDATE profiles SET tokens = tokens + p_amount WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION add_tokens(UUID, INTEGER) TO service_role;

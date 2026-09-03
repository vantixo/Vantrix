-- ═══════════════════════════════════════════════════════════════════════
-- P0 fix: deduct_tokens() param-name regression.
--
-- 20260930b_lock_privileged_rpcs.sql (correctly) re-created deduct_tokens
-- as SECURITY DEFINER / service_role-only and added the `amount <= 0`
-- guard, but in doing so it reverted the function's parameter names from
-- (p_user_id, p_amount) — set by 20260723_fix_deduct_tokens_param_names.sql
-- and matched by src/types/supabase.ts and every application call site —
-- back to the original (user_id, amount).
--
-- PostgREST's RPC endpoint resolves named JSON args against the actual
-- function parameter names, so every caller in the app (character
-- creation, character import, chat image, chat video status, dating
-- scenes, digital twin training, batch image generation, voice/TTS —
-- all of which call `.rpc('deduct_tokens', { p_user_id, p_amount })`)
-- would fail against the function as currently deployed.
--
-- This migration re-creates deduct_tokens with the (p_user_id, p_amount)
-- signature while preserving every security property added in
-- 20260930b: SECURITY DEFINER, service_role-only grant, search_path
-- lockdown, and the amount <= 0 rejection.
--
-- Because Postgres function identity includes the parameter list,
-- CREATE OR REPLACE cannot rename parameters in place if the old
-- (user_id, amount)-named overload is still around under a different
-- signature — it isn't here (same types, same arg count), so
-- CREATE OR REPLACE is sufficient. No DROP needed.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION deduct_tokens(p_user_id UUID, p_amount INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_tokens INTEGER;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount'
      USING HINT = 'deduct_tokens requires a positive amount; use add_tokens() for credits/refunds';
  END IF;

  UPDATE profiles
  SET tokens = tokens - p_amount
  WHERE id = p_user_id AND tokens >= p_amount
  RETURNING tokens INTO v_tokens;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'insufficient_tokens'
      USING HINT = 'User does not have enough tokens';
  END IF;

  RETURN v_tokens;
END;
$$;

-- Re-assert service_role-only (CREATE OR REPLACE does not touch grants,
-- but this keeps the migration self-contained/idempotent if ever re-run
-- against a database that somehow lost the 20260930b grant).
REVOKE EXECUTE ON FUNCTION deduct_tokens(UUID, INTEGER) FROM authenticated, anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION deduct_tokens(UUID, INTEGER) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- P0 fix: character-creation refund path.
--
-- src/app/api/characters/route.ts (and characters/import/route.ts) call
-- deduct_tokens(p_user_id, -CHARACTER_CREATION_COST) as a "refund" when
-- character insert fails after the charge. deduct_tokens now explicitly
-- rejects amount <= 0 (by design — refunds must use add_tokens()), so
-- that refund call fails, and the failure is only logged, not surfaced
-- or retried: the user is left charged 100 coins with no character.
--
-- Fix: a dedicated refund_tokens() RPC that wraps add_tokens() so the
-- application can call one clearly-named, always-positive-amount RPC
-- for compensating transactions, instead of passing a negative number
-- to a debit function. This does not by itself make charge+insert
-- atomic (that would require moving the whole character-creation flow
-- into a single RPC/transaction — tracked separately as a P1/P2), but
-- it makes the existing best-effort refund actually succeed instead of
-- silently failing every time.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION refund_tokens(p_user_id UUID, p_amount INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_tokens INTEGER;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount'
      USING HINT = 'refund_tokens requires a positive amount to credit';
  END IF;

  UPDATE profiles
  SET tokens = tokens + p_amount
  WHERE id = p_user_id
  RETURNING tokens INTO v_tokens;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user_not_found'
      USING HINT = 'No profile row for p_user_id';
  END IF;

  RETURN v_tokens;
END;
$$;

REVOKE EXECUTE ON FUNCTION refund_tokens(UUID, INTEGER) FROM authenticated, anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION refund_tokens(UUID, INTEGER) TO service_role;

-- FIX: deduct_tokens() was defined with unprefixed parameter names
-- (user_id, amount), but every single call site in the app
-- (characters/route.ts, images/generate-batch, image-studio, voice/tts,
-- chat/image) invokes it via supabase-js .rpc('deduct_tokens', { p_user_id,
-- p_amount }). PostgREST resolves named-parameter RPC calls by exact
-- parameter name, so none of those calls have ever matched this function's
-- signature — every one of them either silently failed (fire-and-forget
-- call sites, where the returned {error} is never inspected) or surfaced a
-- generic "function not found" failure (call sites that do check {error}).
-- Net effect: token spend was never actually enforced for character
-- creation (the .rpc() call is unchecked there — see characters/route.ts),
-- and correctly-guarded routes were spuriously rejecting legitimate charges.
--
-- CREATE OR REPLACE FUNCTION cannot rename parameters in place in Postgres —
-- doing so raises "cannot change name of input parameter". The function's
-- signature (arg types) is unchanged, but the names must be renamed via
-- DROP + CREATE, not REPLACE. Internal positional callers (spend_tokens(),
-- the gift/consumption RPCs) are unaffected either way since they call
-- positionally, not by parameter name.
DROP FUNCTION IF EXISTS deduct_tokens(UUID, INTEGER);

CREATE FUNCTION deduct_tokens(p_user_id UUID, p_amount INTEGER)
RETURNS INTEGER AS $$
DECLARE v_tokens INTEGER;
BEGIN
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION deduct_tokens(UUID, INTEGER) TO authenticated;

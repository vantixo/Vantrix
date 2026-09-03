-- ADMIN-FREE-TIER (payments follow-up): admins were still subject to
-- deduct_tokens() raising insufficient_tokens like any paying user, even
-- though the application layer (resolveEffectiveTier / requirePlan) now
-- treats them as top-tier for rate limits and plan gates. Every feature
-- that also charges tokens per-use (image generation, voice TTS, dating
-- gifts, character creation) still called this function directly, so an
-- admin with a low/zero token balance would still get a 402
-- INSUFFICIENT_TOKENS error on those specific actions — a real "some
-- tasks work, some don't" gap for staff access.
--
-- Fixed at this layer (the DB function itself), not just in application
-- code: every call site — present and future — routes through
-- deduct_tokens(), so this is the one place a bypass can't be missed by a
-- new route forgetting to check admin status itself. Mirrors the same
-- role OR is_admin check used by requireAdmin() / resolveEffectiveTier()
-- / the DB's own is_admin() function, so all four stay consistent.
--
-- Admins' `tokens` balance is left untouched entirely (not even
-- decremented then silently topped back up) — matches
-- credit_subscription_tokens/activatePaystackSubscription semantics of
-- never writing billing-shaped numbers for accounts with no real
-- subscription, and keeps token-economy metrics honest.
CREATE OR REPLACE FUNCTION deduct_tokens(p_user_id UUID, p_amount INTEGER)
RETURNS INTEGER AS $$
DECLARE
  v_tokens   INTEGER;
  v_is_admin BOOLEAN;
BEGIN
  SELECT (role = 'admin' OR is_admin IS TRUE) INTO v_is_admin
  FROM profiles WHERE id = p_user_id;

  IF v_is_admin THEN
    SELECT tokens INTO v_tokens FROM profiles WHERE id = p_user_id;
    RETURN COALESCE(v_tokens, 0);
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION deduct_tokens(UUID, INTEGER) TO authenticated;

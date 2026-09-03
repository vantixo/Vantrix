-- ─────────────────────────────────────────────────────────────────────────
-- BUG FIX: personality drift silently never accumulates for established/
-- deep-stage relationships
-- ─────────────────────────────────────────────────────────────────────────
-- computeSessionDrift() (personality-evolution.ts) intentionally returns
-- small fractional deltas per session (e.g. 0.06 for an "established"-stage
-- relationship with a 10-message session) — drift is supposed to be SLOW,
-- accumulating over many sessions. But character_psychology.*_drift columns
-- were SMALLINT, and the call site in chat/stream/route.ts rounded each
-- delta with Math.round() before calling apply_personality_drift(), because
-- the RPC's parameters were also INTEGER.
--
-- Math.round(0.06) = 0. Every single session for 'established' and 'deep'
-- stage relationships (rate 0.15 / 0.05) rounds to zero drift, no matter how
-- many sessions accumulate — the RPC call still fires, it just always adds
-- zero. Only 'early' stage (rate 0.5) with a long session ever produced a
-- nonzero rounded value. In other words: the exact users this feature is
-- meant to serve (long-term relationships, "she's really opening up to me"
-- over months) never actually drifted at all.
--
-- Fix: store drift as NUMERIC(5,2) instead of SMALLINT, and change the RPC
-- to accept NUMERIC parameters so fractional deltas actually accumulate.
-- The application-side Math.round() calls at the caller are removed in the
-- same fix (see chat/stream/route.ts).

ALTER TABLE character_psychology
  ALTER COLUMN openness_drift   TYPE NUMERIC(5,2) USING openness_drift::NUMERIC(5,2),
  ALTER COLUMN warmth_drift     TYPE NUMERIC(5,2) USING warmth_drift::NUMERIC(5,2),
  ALTER COLUMN confidence_drift TYPE NUMERIC(5,2) USING confidence_drift::NUMERIC(5,2);

ALTER TABLE character_psychology
  ALTER COLUMN openness_drift   SET DEFAULT 0,
  ALTER COLUMN warmth_drift     SET DEFAULT 0,
  ALTER COLUMN confidence_drift SET DEFAULT 0;

-- Replace the RPC with a NUMERIC-parameter version. Drop the old INTEGER
-- overload explicitly first — Postgres treats different parameter types as
-- a distinct function signature, so CREATE OR REPLACE alone would leave the
-- old INTEGER version lying around as dead, still-callable code.
DROP FUNCTION IF EXISTS apply_personality_drift(UUID, UUID, INTEGER, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION apply_personality_drift(
  p_user_id UUID, p_character_id UUID,
  p_openness NUMERIC, p_warmth NUMERIC, p_confidence NUMERIC
) RETURNS VOID AS $$
BEGIN
  UPDATE character_psychology SET
    openness_drift   = GREATEST(-50, LEAST(50, openness_drift   + p_openness)),
    warmth_drift     = GREATEST(-50, LEAST(50, warmth_drift     + p_warmth)),
    confidence_drift = GREATEST(-50, LEAST(50, confidence_drift + p_confidence))
  WHERE user_id = p_user_id AND character_id = p_character_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION apply_personality_drift(UUID, UUID, NUMERIC, NUMERIC, NUMERIC) TO authenticated, service_role;

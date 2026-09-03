-- ═══════════════════════════════════════════════════════════════════════
-- First Dates + Relationship Forecast — additive migration
--
-- FIRST DATES (master prompt Feature 12): a structured date experience,
-- distinct from the existing ad-hoc mood-room scene images
-- (/api/dating/scene). A date has a type (cafe, walk, gallery, ...), an
-- AI-generated narration in the character's voice grounded in relationship
-- context, and produces a real memory the user can revisit — mirrors the
-- send_gift() atomic pattern already used for gifts.
--
-- RELATIONSHIP FORECAST (Feature 15): purely computed from data that
-- already exists (dating_matches, dating_compatibility.breakdown,
-- dating_gifts, dating_milestones) — no new table required, no LLM call
-- needed, so nothing to migrate for it here. See src/lib/dating/engine.ts
-- computeRelationshipForecast() and src/app/api/dating/forecast/route.ts.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS date_sessions (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id       UUID        NOT NULL REFERENCES dating_matches(id) ON DELETE CASCADE,
  user_id        UUID        NOT NULL REFERENCES profiles(id)       ON DELETE CASCADE,
  character_id   UUID        NOT NULL REFERENCES characters(id)     ON DELETE CASCADE,
  date_type      TEXT        NOT NULL,
  status         TEXT        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'completed', 'abandoned')),
  opening_scene  TEXT        NOT NULL,
  token_cost     INTEGER     NOT NULL DEFAULT 0,
  bond_bonus     SMALLINT    NOT NULL DEFAULT 0,
  conversation_id UUID        REFERENCES conversations(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_date_sessions_match   ON date_sessions(match_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_date_sessions_user     ON date_sessions(user_id, created_at DESC);
-- Enforce "one active date per match at a time" so a user can't stack
-- concurrent date sessions against the same character.
CREATE UNIQUE INDEX IF NOT EXISTS idx_date_sessions_one_active
  ON date_sessions(match_id) WHERE status = 'active';

ALTER TABLE date_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "date_sessions_own_read" ON date_sessions;
DROP POLICY IF EXISTS "date_sessions_service"   ON date_sessions;
CREATE POLICY "date_sessions_own_read" ON date_sessions FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "date_sessions_service"  ON date_sessions FOR ALL    TO service_role USING (TRUE);

-- ── first_date milestone bit ──────────────────────────────────────────────
-- MILESTONE_FLAGS (src/lib/dating/constants.ts) currently runs
-- 1,2,4,8,16 — next free power of two is 32.
-- No schema change needed for the bitmask itself (dating_matches.milestones
-- is already a plain INTEGER); this comment documents the new bit so future
-- migrations don't collide with it. Application-side addition lives in
-- constants.ts.

-- ── Atomic date-session start (mirrors send_gift's atomicity guarantee) ────
-- Deduct tokens and insert the session in one transaction — partial failure
-- (tokens taken, no session created) is impossible.
CREATE OR REPLACE FUNCTION start_date_session(
  p_user_id        UUID,
  p_match_id       UUID,
  p_char_id        UUID,
  p_date_type      TEXT,
  p_opening_scene  TEXT,
  p_token_cost     INTEGER,
  p_bond_bonus     INTEGER,
  p_conversation_id UUID DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_session_id UUID;
BEGIN
  IF p_token_cost > 0 THEN
    PERFORM deduct_tokens(p_user_id, p_token_cost);
  END IF;

  INSERT INTO date_sessions
    (match_id, user_id, character_id, date_type, opening_scene, token_cost, bond_bonus, conversation_id)
  VALUES
    (p_match_id, p_user_id, p_char_id, p_date_type, p_opening_scene, p_token_cost, p_bond_bonus, p_conversation_id)
  RETURNING id INTO v_session_id;

  RETURN v_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER FUNCTION public.start_date_session(uuid, uuid, uuid, text, text, integer, integer, uuid)
  SET search_path = public, pg_temp;

-- ── Atomic date-session completion ──────────────────────────────────────
-- Marks the session completed and applies its bond bonus via the existing
-- update_bond_score() function, in one transaction.
CREATE OR REPLACE FUNCTION complete_date_session(
  p_session_id UUID,
  p_user_id    UUID
) RETURNS INTEGER AS $$
DECLARE
  v_match_id   UUID;
  v_bond_bonus INTEGER;
  v_new_bond   INTEGER;
BEGIN
  SELECT match_id, bond_bonus INTO v_match_id, v_bond_bonus
  FROM date_sessions
  WHERE id = p_session_id AND user_id = p_user_id AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'date_session_not_found_or_already_completed';
  END IF;

  UPDATE date_sessions
  SET status = 'completed', completed_at = NOW()
  WHERE id = p_session_id;

  SELECT update_bond_score(v_match_id, v_bond_bonus) INTO v_new_bond;
  RETURN COALESCE(v_new_bond, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER FUNCTION public.complete_date_session(uuid, uuid)
  SET search_path = public, pg_temp;

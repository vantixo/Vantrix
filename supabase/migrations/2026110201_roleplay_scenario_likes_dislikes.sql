-- ─────────────────────────────────────────────────────────────────────────────
-- Roleplay Scenarios — Like / Dislike votes
--
-- Mirrors the existing post_likes / toggle_post_like pattern (20240101), but
-- for two mutually-exclusive vote types instead of one: a user has at most
-- one row in roleplay_scenario_votes per scenario, either 'like' or
-- 'dislike'. Casting the opposite vote switches it; casting the same vote
-- again clears it. roleplay_scenarios.like_count / dislike_count are kept in
-- sync inside toggle_scenario_vote() itself (no trigger — same direct-update
-- style as toggle_post_like/toggle_character_like), so every mutation is one
-- round trip.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE roleplay_scenarios
  ADD COLUMN IF NOT EXISTS like_count    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dislike_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS roleplay_scenario_votes (
  scenario_id UUID        NOT NULL REFERENCES roleplay_scenarios(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES profiles(id)           ON DELETE CASCADE,
  vote_type   TEXT        NOT NULL CHECK (vote_type IN ('like', 'dislike')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scenario_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_roleplay_scenario_votes_scenario ON roleplay_scenario_votes (scenario_id);

ALTER TABLE roleplay_scenario_votes ENABLE ROW LEVEL SECURITY;

-- Public-read (same as post_likes) so a picker can compute "did I vote"
-- client-side too; actual mutation goes through the SECURITY DEFINER
-- function below regardless of these policies.
DROP POLICY IF EXISTS "roleplay_scenario_votes_read"   ON roleplay_scenario_votes;
DROP POLICY IF EXISTS "roleplay_scenario_votes_insert" ON roleplay_scenario_votes;
DROP POLICY IF EXISTS "roleplay_scenario_votes_update" ON roleplay_scenario_votes;
DROP POLICY IF EXISTS "roleplay_scenario_votes_delete" ON roleplay_scenario_votes;

CREATE POLICY "roleplay_scenario_votes_read"   ON roleplay_scenario_votes FOR SELECT USING (TRUE);
CREATE POLICY "roleplay_scenario_votes_insert" ON roleplay_scenario_votes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "roleplay_scenario_votes_update" ON roleplay_scenario_votes FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "roleplay_scenario_votes_delete" ON roleplay_scenario_votes FOR DELETE USING (auth.uid() = user_id);

-- Atomic three-state toggle: no vote -> like/dislike -> switch -> clear.
CREATE OR REPLACE FUNCTION toggle_scenario_vote(p_scenario_id UUID, p_user_id UUID, p_vote_type TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_existing     TEXT;
  v_like_count   INTEGER;
  v_dislike_count INTEGER;
  v_new_vote     TEXT;
BEGIN
  IF p_vote_type NOT IN ('like', 'dislike') THEN
    RAISE EXCEPTION 'Invalid vote type';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM roleplay_scenarios WHERE id = p_scenario_id) THEN
    RAISE EXCEPTION 'Scenario not found';
  END IF;

  SELECT vote_type INTO v_existing
  FROM roleplay_scenario_votes
  WHERE scenario_id = p_scenario_id AND user_id = p_user_id;

  IF v_existing IS NULL THEN
    -- No prior vote: cast it.
    INSERT INTO roleplay_scenario_votes (scenario_id, user_id, vote_type)
    VALUES (p_scenario_id, p_user_id, p_vote_type);
    UPDATE roleplay_scenarios SET
      like_count    = like_count    + CASE WHEN p_vote_type = 'like'    THEN 1 ELSE 0 END,
      dislike_count = dislike_count + CASE WHEN p_vote_type = 'dislike' THEN 1 ELSE 0 END
    WHERE id = p_scenario_id;
    v_new_vote := p_vote_type;

  ELSIF v_existing = p_vote_type THEN
    -- Same vote again: clear it.
    DELETE FROM roleplay_scenario_votes WHERE scenario_id = p_scenario_id AND user_id = p_user_id;
    UPDATE roleplay_scenarios SET
      like_count    = GREATEST(0, like_count    - CASE WHEN p_vote_type = 'like'    THEN 1 ELSE 0 END),
      dislike_count = GREATEST(0, dislike_count - CASE WHEN p_vote_type = 'dislike' THEN 1 ELSE 0 END)
    WHERE id = p_scenario_id;
    v_new_vote := NULL;

  ELSE
    -- Opposite vote: switch it.
    UPDATE roleplay_scenario_votes SET vote_type = p_vote_type, created_at = NOW()
    WHERE scenario_id = p_scenario_id AND user_id = p_user_id;
    UPDATE roleplay_scenarios SET
      like_count    = GREATEST(0, like_count    + CASE WHEN p_vote_type = 'like'    THEN 1 WHEN v_existing = 'like'    THEN -1 ELSE 0 END),
      dislike_count = GREATEST(0, dislike_count + CASE WHEN p_vote_type = 'dislike' THEN 1 WHEN v_existing = 'dislike' THEN -1 ELSE 0 END)
    WHERE id = p_scenario_id;
    v_new_vote := p_vote_type;
  END IF;

  SELECT like_count, dislike_count INTO v_like_count, v_dislike_count
  FROM roleplay_scenarios WHERE id = p_scenario_id;

  RETURN jsonb_build_object(
    'vote', v_new_vote,
    'like_count', COALESCE(v_like_count, 0),
    'dislike_count', COALESCE(v_dislike_count, 0)
  );
END;
$$;

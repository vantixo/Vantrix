-- Character Likes & Follows
--
-- Mirrors the pattern from 20241200_community_like_toggle_rpc.sql: a single
-- Postgres function does the read-check-mutate-write under one row lock so
-- concurrent toggles serialize correctly instead of racing on independent
-- reads (same bug class that migration fixed for community posts).
--
-- Likes reuse the existing `characters.like_count` column (already read by
-- discover/recommendations) and add a `liked_by` jsonb array, same shape as
-- community_posts.liked_by.
--
-- Follows are a proper join table rather than a jsonb array — follower
-- lists are meant to be queried ("who follows this character", "characters
-- a user follows"), not just counted, so a real table with indexes fits
-- better than community likes' array-on-the-row approach.

ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS liked_by JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS follower_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS character_follows (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES profiles(id)   ON DELETE CASCADE,
  character_id UUID        NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, character_id)
);

CREATE INDEX IF NOT EXISTS idx_character_follows_character ON character_follows (character_id);
CREATE INDEX IF NOT EXISTS idx_character_follows_user      ON character_follows (user_id, created_at DESC);

ALTER TABLE character_follows ENABLE ROW LEVEL SECURITY;

-- A user can see and manage only their own follow rows directly; counts are
-- public via characters.follower_count, so the raw follow list doesn't need
-- to be publicly readable.
CREATE POLICY character_follows_owner_all
  ON character_follows
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── Like toggle ─────────────────────────────────────────────────────────────

-- The legacy toggle_character_like() from 20240101_production.sql has the
-- same (UUID, UUID) argument types (Postgres overload resolution ignores
-- parameter names) but returns JSONB against a separate character_likes
-- table. CREATE OR REPLACE cannot change an existing function's return
-- type, so this must DROP first to actually swap in the liked_by/JSON
-- version the app's /api/characters/[id]/like route expects.
DROP FUNCTION IF EXISTS toggle_character_like(UUID, UUID);

CREATE FUNCTION toggle_character_like(p_character_id UUID, p_user_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_was_liked BOOLEAN;
  v_new_count INTEGER;
BEGIN
  PERFORM 1 FROM characters WHERE id = p_character_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Character not found';
  END IF;

  SELECT (liked_by ? p_user_id::text) INTO v_was_liked
  FROM characters WHERE id = p_character_id;

  IF v_was_liked THEN
    UPDATE characters
    SET liked_by = (
          SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
          FROM jsonb_array_elements_text(liked_by) elem
          WHERE elem <> p_user_id::text
        ),
        like_count = GREATEST(0, like_count - 1)
    WHERE id = p_character_id
    RETURNING like_count INTO v_new_count;
  ELSE
    UPDATE characters
    SET liked_by   = liked_by || to_jsonb(p_user_id::text),
        like_count = like_count + 1
    WHERE id = p_character_id
    RETURNING like_count INTO v_new_count;
  END IF;

  RETURN json_build_object('liked', NOT v_was_liked, 'like_count', v_new_count);
END;
$$;

GRANT EXECUTE ON FUNCTION toggle_character_like(UUID, UUID) TO authenticated;

-- ── Follow toggle ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION toggle_character_follow(p_character_id UUID, p_user_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_was_following BOOLEAN;
  v_new_count     INTEGER;
BEGIN
  PERFORM 1 FROM characters WHERE id = p_character_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Character not found';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM character_follows
    WHERE character_id = p_character_id AND user_id = p_user_id
  ) INTO v_was_following;

  IF v_was_following THEN
    DELETE FROM character_follows
    WHERE character_id = p_character_id AND user_id = p_user_id;

    UPDATE characters
    SET follower_count = GREATEST(0, follower_count - 1)
    WHERE id = p_character_id
    RETURNING follower_count INTO v_new_count;
  ELSE
    INSERT INTO character_follows (character_id, user_id)
    VALUES (p_character_id, p_user_id)
    ON CONFLICT (user_id, character_id) DO NOTHING;

    UPDATE characters
    SET follower_count = follower_count + 1
    WHERE id = p_character_id
    RETURNING follower_count INTO v_new_count;
  END IF;

  RETURN json_build_object('following', NOT v_was_following, 'follower_count', v_new_count);
END;
$$;

GRANT EXECUTE ON FUNCTION toggle_character_follow(UUID, UUID) TO authenticated;

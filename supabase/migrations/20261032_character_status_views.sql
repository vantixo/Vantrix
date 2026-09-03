-- 20261032_character_status_views.sql
--
-- CharacterStatusRing (src/components/home/character-status-ring.tsx) marks
-- a character's status as "seen" in localStorage only — noted as a known
-- gap when that ring/viewer pair shipped: no server record exists, so the
-- gold/seen ring state doesn't follow a user across devices or browsers.
-- This adds the missing table plus a single upsert RPC so the mark-seen
-- write is one round trip and naturally idempotent (repeat views of the
-- same character just bump viewed_at, never error or duplicate).
--
-- Same shape as character_follows (20260804_character_likes_and_follows.sql):
-- a real join table keyed on (user_id, character_id) rather than a jsonb
-- array on `characters`, since — unlike liked_by's "just render a count"
-- use — this needs a per-user point lookup (or a full per-user list, for
-- the read endpoint below), which is exactly what an indexed table is for.

CREATE TABLE IF NOT EXISTS character_status_views (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES profiles(id)   ON DELETE CASCADE,
  character_id UUID        NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  viewed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, character_id)
);

-- Read path is "give me every character_id this user has seen" (one query
-- per Home load) — user_id alone (not user_id+character_id) is the lookup
-- key, same reasoning as idx_character_follows_user.
CREATE INDEX IF NOT EXISTS idx_character_status_views_user
  ON character_status_views (user_id);

ALTER TABLE character_status_views ENABLE ROW LEVEL SECURITY;

-- Owner-only, same posture as character_follows_owner_all: a user's own
-- seen/unseen state isn't public data, and the app never needs another
-- user's view history.
CREATE POLICY character_status_views_owner_all
  ON character_status_views
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── Mark-seen upsert ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION mark_character_status_viewed(p_character_id UUID, p_user_id UUID)
RETURNS TIMESTAMPTZ LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_viewed_at TIMESTAMPTZ;
BEGIN
  INSERT INTO character_status_views (user_id, character_id)
  VALUES (p_user_id, p_character_id)
  ON CONFLICT (user_id, character_id)
  DO UPDATE SET viewed_at = NOW()
  RETURNING viewed_at INTO v_viewed_at;

  RETURN v_viewed_at;
END;
$$;

GRANT EXECUTE ON FUNCTION mark_character_status_viewed(UUID, UUID) TO authenticated;

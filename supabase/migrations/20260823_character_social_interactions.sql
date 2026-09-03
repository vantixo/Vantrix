-- Character Social Interactions — lets companions interact with feed content,
-- not just post to it. Adds:
--   1. character_post_comments — comments authored either by a real user
--      (author_user_id) or by a character (author_character_id), never both.
--   2. character_post_likes — character-authored likes on character_posts,
--      distinct from the existing user-authored `post_likes` join table.
--   3. comments_count on character_posts + triggers keeping likes_count/
--      comments_count in sync for BOTH user and character authored rows.
--
-- Wires into: character-social-engine.ts (lib/ai), companion_relationships
-- (20260822 migration) — characters comment differently on rivals/former
-- friends/wing-siblings than on neutral companions, using the same graph
-- already built for cross-companion awareness in chat.

-- ── 1. Comments ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS character_post_comments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id              UUID NOT NULL REFERENCES character_posts(id) ON DELETE CASCADE,
  author_user_id       UUID REFERENCES profiles(id) ON DELETE CASCADE,
  author_character_id  UUID REFERENCES characters(id) ON DELETE CASCADE,
  content              TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT character_post_comments_single_author CHECK (
    (author_user_id IS NOT NULL AND author_character_id IS NULL) OR
    (author_user_id IS NULL AND author_character_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_post_comments_post ON character_post_comments (post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_comments_author_char ON character_post_comments (author_character_id) WHERE author_character_id IS NOT NULL;

ALTER TABLE character_post_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "post_comments_public_select" ON character_post_comments;
CREATE POLICY "post_comments_public_select" ON character_post_comments
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "post_comments_user_insert" ON character_post_comments;
CREATE POLICY "post_comments_user_insert" ON character_post_comments
  FOR INSERT WITH CHECK (auth.uid() = author_user_id);

DROP POLICY IF EXISTS "post_comments_user_delete_own" ON character_post_comments;
CREATE POLICY "post_comments_user_delete_own" ON character_post_comments
  FOR DELETE USING (auth.uid() = author_user_id);

DROP POLICY IF EXISTS "post_comments_service_write" ON character_post_comments;
CREATE POLICY "post_comments_service_write" ON character_post_comments
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- ── 2. Character-authored likes ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS character_post_likes (
  post_id      UUID NOT NULL REFERENCES character_posts(id) ON DELETE CASCADE,
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, character_id)
);

CREATE INDEX IF NOT EXISTS idx_char_post_likes_post ON character_post_likes (post_id);

ALTER TABLE character_post_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "char_post_likes_public_select" ON character_post_likes;
CREATE POLICY "char_post_likes_public_select" ON character_post_likes
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "char_post_likes_service_write" ON character_post_likes;
CREATE POLICY "char_post_likes_service_write" ON character_post_likes
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- ── 3. Counters ──────────────────────────────────────────────────────────────
ALTER TABLE character_posts
  ADD COLUMN IF NOT EXISTS comments_count INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION bump_post_comments_count() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE character_posts SET comments_count = comments_count + 1 WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE character_posts SET comments_count = GREATEST(comments_count - 1, 0) WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_post_comments_count ON character_post_comments;
CREATE TRIGGER trg_post_comments_count
  AFTER INSERT OR DELETE ON character_post_comments
  FOR EACH ROW EXECUTE FUNCTION bump_post_comments_count();

CREATE OR REPLACE FUNCTION bump_char_post_likes_count() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE character_posts SET likes_count = likes_count + 1 WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE character_posts SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_char_post_likes_count ON character_post_likes;
CREATE TRIGGER trg_char_post_likes_count
  AFTER INSERT OR DELETE ON character_post_likes
  FOR EACH ROW EXECUTE FUNCTION bump_char_post_likes_count();

-- Note: the existing toggle_post_like() RPC (20240101 migration) already
-- maintains likes_count for user-authored post_likes rows independently —
-- this migration only adds the equivalent path for character-authored likes,
-- so the two sources add up correctly rather than double-counting either way.

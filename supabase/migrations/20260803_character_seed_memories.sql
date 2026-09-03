-- Character Seed Memories — creator-authored baseline "lore" memories.
--
-- Distinct from priority_memories: priority_memories is per (user_id,
-- character_id) and populated at runtime from a specific user's
-- conversation (memory_graph / user_facts / manual). This table is
-- authored once by the creator in Creator Studio's Memory Builder and is
-- character-scoped only — every new conversation with this character
-- starts with these as foundational context, the same for every user.
--
-- Read at chat-init time by the AI orchestrator (context assembly), the
-- same way `backstory` / `personality` are — just structured as discrete,
-- weighted facts instead of one prose blob.
CREATE TABLE IF NOT EXISTS character_seed_memories (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id UUID        NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  creator_id   UUID        NOT NULL REFERENCES profiles(id)   ON DELETE CASCADE,

  category     TEXT        NOT NULL DEFAULT 'general', -- e.g. 'relationship', 'event', 'preference', 'secret'
  headline     TEXT        NOT NULL,                    -- short label shown in the builder list
  content      TEXT        NOT NULL,                    -- the actual memory text fed to the model
  importance   SMALLINT    NOT NULL DEFAULT 50 CHECK (importance BETWEEN 0 AND 100),
  position     INT         NOT NULL DEFAULT 0,          -- manual ordering within the builder

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_character_seed_memories_character
  ON character_seed_memories (character_id, importance DESC, position ASC);

ALTER TABLE character_seed_memories ENABLE ROW LEVEL SECURITY;

-- Owner can fully manage their own character's seed memories.
CREATE POLICY character_seed_memories_owner_all
  ON character_seed_memories
  FOR ALL
  USING (creator_id = auth.uid())
  WITH CHECK (creator_id = auth.uid());

-- Anyone can read seed memories for a character that is public and approved
-- (needed so chat context-assembly can run under a non-admin client if ever
-- required; service-role reads bypass this anyway).
CREATE POLICY character_seed_memories_public_read
  ON character_seed_memories
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM characters c
      WHERE c.id = character_seed_memories.character_id
        AND c.is_public = true
        AND c.moderation_status = 'approved'
    )
  );

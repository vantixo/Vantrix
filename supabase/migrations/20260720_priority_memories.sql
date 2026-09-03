-- Priority Memory — a filtered, user-visible layer on top of memory_graph
-- and user_facts.
--
-- Both source tables already capture a lot: every memory event, every
-- extracted fact, regardless of importance. This table holds only the
-- subset judged important enough to surface directly to the user (a
-- "memories" page) and to reference at chat time / export for training —
-- each row carries extracted keywords and an importance score, not just
-- raw content.
--
-- Populated by src/lib/ai/priority-memory.ts's promote*() functions,
-- called fire-and-forget right after a memory_graph node or user_facts row
-- is written. Never written to directly by request handlers.
CREATE TABLE IF NOT EXISTS priority_memories (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES profiles(id)   ON DELETE CASCADE,
  character_id UUID        NOT NULL REFERENCES characters(id) ON DELETE CASCADE,

  -- Which table this was promoted from, and that row's id — lets us
  -- de-dupe re-promotion (e.g. a fact's confidence rising on a later
  -- message shouldn't create a second row) and lets a future job walk
  -- back to the source record if needed.
  source        TEXT       NOT NULL CHECK (source IN ('memory_graph', 'user_facts', 'manual')),
  source_id     UUID,

  category      TEXT       NOT NULL,          -- event_type or fact category, carried through as-is
  headline      TEXT       NOT NULL,           -- short, user-facing summary (<=120 chars)
  content       TEXT       NOT NULL,           -- fuller text (memory description or fact value)
  keywords      TEXT[]     NOT NULL DEFAULT '{}',
  importance    SMALLINT   NOT NULL DEFAULT 50 CHECK (importance BETWEEN 0 AND 100),

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (user_id, character_id, source, source_id)
);

CREATE INDEX IF NOT EXISTS idx_priority_memories_user_character
  ON priority_memories (user_id, character_id, importance DESC, created_at DESC);

-- GIN index so keyword lookups ("show memories mentioning 'guitar'") are
-- fast even as this table grows — used by the user-facing API's optional
-- ?keyword= filter.
CREATE INDEX IF NOT EXISTS idx_priority_memories_keywords
  ON priority_memories USING GIN (keywords);

ALTER TABLE priority_memories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "priority_memories_own_read" ON priority_memories;
DROP POLICY IF EXISTS "priority_memories_service"   ON priority_memories;

-- Same pattern as memory_graph/user_facts: users can read their own rows
-- directly (this table is designed to be shown in the UI); all writes
-- happen server-side via supabaseAdmin (service_role), never from the
-- authenticated user's own session.
CREATE POLICY "priority_memories_own_read" ON priority_memories FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "priority_memories_service"  ON priority_memories FOR ALL    TO service_role USING (TRUE);

COMMENT ON TABLE priority_memories IS
  'Filtered, keyword-tagged, user-visible subset of memory_graph/user_facts — surfaced in the memories UI, referenced at chat time, and exported (consent-gated) for Kaetah training/character-building.';

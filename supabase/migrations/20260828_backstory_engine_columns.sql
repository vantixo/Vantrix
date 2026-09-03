-- ─────────────────────────────────────────────────────────────────────────────
-- backstory_expanded_at / backstory_expansion_count — cadence tracking for
-- src/lib/ai/backstory-engine.ts (the Backstory Content Engine).
--
-- Character-scoped (not per-user), so this lives on the characters row
-- itself rather than in Redis like identity-core.ts's per-(user,character)
-- state — there is exactly one of these per character.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS backstory_expanded_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS backstory_expansion_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN characters.backstory_expanded_at IS
  'Last time backstory-engine.ts auto-generated a new character_knowledge entry for this character. NULL = never expanded.';
COMMENT ON COLUMN characters.backstory_expansion_count IS
  'Total auto-generated character_knowledge entries created by backstory-engine.ts. Capped at MAX_AUTO_ENTRIES in application code.';

CREATE INDEX IF NOT EXISTS idx_characters_backstory_expanded_at
  ON characters (backstory_expanded_at NULLS FIRST)
  WHERE active = true;

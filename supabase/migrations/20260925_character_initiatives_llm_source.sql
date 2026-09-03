-- Character Initiatives: track whether the opener was LLM-generated or
-- fell back to the static template pool (LLM timeout/error/empty reply).
-- Useful for monitoring generation quality and rollout of the LLM path.

ALTER TABLE character_initiatives
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'template'
  CHECK (source IN ('llm', 'template'));

CREATE INDEX IF NOT EXISTS idx_character_initiatives_source
  ON character_initiatives (source);

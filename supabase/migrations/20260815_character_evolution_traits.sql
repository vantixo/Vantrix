-- ─────────────────────────────────────────────────────────────────────────
-- LAW 8: Bidirectional Character Evolution
-- ─────────────────────────────────────────────────────────────────────────
-- Backing table for src/lib/ai/bidirectional-evolution.ts. Tracks specific,
-- open-vocabulary interests/habits a character has genuinely picked up from
-- a given user, with reinforcement-based strength and time-based decay.
--
-- NOTE: this migration was reconstructed from the fields actually read/
-- written by bidirectional-evolution.ts (no vantrix-law8-migration.sql was
-- provided alongside the integration guide) — verify column names/types
-- against your actual Supabase types export before applying to production.

CREATE TABLE IF NOT EXISTS character_evolution_traits (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  character_id    uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  trait_key       text NOT NULL,
  trait_type      text NOT NULL CHECK (trait_type IN ('interest', 'habit')),
  label           text NOT NULL,
  origin_snippet  text,
  exposure_count  integer NOT NULL DEFAULT 1,
  strength        text NOT NULL DEFAULT 'noticing'
                    CHECK (strength IN ('noticing', 'adopted', 'integral', 'faded')),
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT character_evolution_traits_unique UNIQUE (user_id, character_id, trait_key)
);

CREATE INDEX IF NOT EXISTS idx_character_evolution_traits_lookup
  ON character_evolution_traits (user_id, character_id, exposure_count DESC);

CREATE INDEX IF NOT EXISTS idx_character_evolution_traits_last_seen
  ON character_evolution_traits (last_seen_at);

-- Keep updated_at fresh on every upsert.
CREATE OR REPLACE FUNCTION set_character_evolution_traits_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_character_evolution_traits_updated_at ON character_evolution_traits;
CREATE TRIGGER trg_character_evolution_traits_updated_at
  BEFORE UPDATE ON character_evolution_traits
  FOR EACH ROW EXECUTE FUNCTION set_character_evolution_traits_updated_at();

-- RLS: users can only read their own traits; writes go through supabaseAdmin
-- (service role) from recordEvolutionSignal(), same pattern as other engine
-- tables in this codebase (memory_graph, character_relationships, etc).
ALTER TABLE character_evolution_traits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own evolution traits" ON character_evolution_traits;
CREATE POLICY "Users can view their own evolution traits"
  ON character_evolution_traits FOR SELECT
  USING (auth.uid() = user_id);

-- NOTE per the integration guide: if you are backfilling from the old
-- personality-evolution.ts dynamic-interests system, seed those rows at
-- exposure_count = 1 / strength = 'noticing' — that's the honest starting
-- point (the prior system never tracked reinforcement), not a
-- reconstruction of history that doesn't exist. No backfill is run
-- automatically by this migration; do it explicitly and deliberately if
-- you want it.

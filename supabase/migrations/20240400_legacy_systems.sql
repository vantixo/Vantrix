-- ============================================================================
-- Vantrix — Legacy Systems Migration
-- Status · Legends · Scarcity · Visual Identity · World History
--
-- Apply AFTER: 20240200_companion_universe.sql, 20240300_world_expansion.sql,
--              20240301_companion_occupations.sql
-- ============================================================================

-- ── 1. Character Attributes ───────────────────────────────────────────────────
-- The deep simulation layer: health, skills, wealth, confidence, addictions.
-- Distinct from companion_reputation (narrative fame) — this is lived condition.

CREATE TABLE IF NOT EXISTS character_attributes (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id    UUID          NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  health          SMALLINT      NOT NULL DEFAULT 85   CHECK (health BETWEEN 0 AND 100),
  confidence      SMALLINT      NOT NULL DEFAULT 60   CHECK (confidence BETWEEN 0 AND 100),
  net_worth       BIGINT        NOT NULL DEFAULT 5000,
  wealth_tier     TEXT          NOT NULL DEFAULT 'modest'
                    CHECK (wealth_tier IN ('destitute','struggling','modest','comfortable','wealthy','rich','magnate')),
  skills          JSONB         NOT NULL DEFAULT '{}',     -- { "negotiation": 62, "combat": 40, ... }
  addictions      TEXT[]        NOT NULL DEFAULT '{}',
  overcome_addictions TEXT[]    NOT NULL DEFAULT '{}',
  political_view  TEXT          DEFAULT 'undeclared',
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT character_attributes_unique UNIQUE (character_id)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'character_attributes_updated_at') THEN
    CREATE TRIGGER character_attributes_updated_at
      BEFORE UPDATE ON character_attributes FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  END IF;
END $$;

-- ── 2. Social Status ───────────────────────────────────────────────────────────
-- Civilization rank — distinct from narrative reputation/fame.
-- Derived from wealth + occupation prestige + faction role + influence.

CREATE TABLE IF NOT EXISTS social_status (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id  UUID          NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  status_tier   TEXT          NOT NULL DEFAULT 'unknown_citizen'
                  CHECK (status_tier IN (
                    'unknown_citizen','skilled_professional','regional_celebrity',
                    'city_leader','corporate_magnate','faction_commander',
                    'global_icon','living_legend'
                  )),
  status_score  INTEGER       NOT NULL DEFAULT 0,
  computed_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT social_status_unique UNIQUE (character_id)
);

CREATE INDEX IF NOT EXISTS social_status_tier_idx ON social_status(status_tier);

-- ── 3. Legends ─────────────────────────────────────────────────────────────────
-- Extremely rare. Enforced scarcity at the application layer (status-legend.ts).

CREATE TABLE IF NOT EXISTS legends (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id    UUID          NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  legend_title    TEXT          NOT NULL,
  legend_type     TEXT          NOT NULL
                    CHECK (legend_type IN (
                      'wealth','discovery','political','military',
                      'cultural','reputation','founder','tragic'
                    )),
  biography       TEXT          NOT NULL,
  criteria_met    JSONB         NOT NULL DEFAULT '{}',
  declared_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  active          BOOLEAN       NOT NULL DEFAULT TRUE,
  CONSTRAINT legends_unique UNIQUE (character_id)
);

CREATE INDEX IF NOT EXISTS legends_active_idx ON legends(active) WHERE active;

-- ── 4. Scarce Assets ───────────────────────────────────────────────────────────
-- Artifacts, titles, offices, historic properties. Finite by design.

CREATE TABLE IF NOT EXISTS scarce_assets (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT          NOT NULL,
  description     TEXT          NOT NULL,
  asset_type      TEXT          NOT NULL
                    CHECK (asset_type IN ('artifact','title','office','property','relic','seat')),
  rarity          TEXT          NOT NULL DEFAULT 'rare'
                    CHECK (rarity IN ('rare','epic','legendary','unique')),
  holder_character_id UUID      REFERENCES characters(id) ON DELETE SET NULL,
  location_id     UUID          REFERENCES world_locations(id) ON DELETE SET NULL,
  history         TEXT[]        NOT NULL DEFAULT '{}',
  acquired_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS scarce_assets_holder_idx ON scarce_assets(holder_character_id);
CREATE INDEX IF NOT EXISTS scarce_assets_type_idx   ON scarce_assets(asset_type);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'scarce_assets_updated_at') THEN
    CREATE TRIGGER scarce_assets_updated_at
      BEFORE UPDATE ON scarce_assets FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  END IF;
END $$;

-- Seed unheld legendary/epic assets — lore objects, claimable through future events
INSERT INTO scarce_assets (name, description, asset_type, rarity, location_id, history)
SELECT v.name, v.description, v.asset_type, v.rarity, l.id, ARRAY[v.origin]
FROM (VALUES
  ('The First Ledger',          'The original accounting record of the world''s oldest trade agreement. Whoever holds it can prove the original terms of half the city''s property lines.', 'artifact', 'legendary', 'the-archive',     'Believed to predate the Archive itself.'),
  ('Seat of the Seven',         'A literal chair, and the office that comes with it. One of seven. Vacant seats are filled by unanimous vote of the remaining six.',                       'seat',     'unique',    'obsidian-tower',  'Carved when the tower was founded.'),
  ('The Founder''s Sigil',      'A union medallion worn by the original organiser of the Iron Reach uprising. Currently unclaimed — its line of succession was disputed and never resolved.', 'relic',    'epic',      'iron-reach',      'Last confirmed worn forty years ago.'),
  ('Right of Undercroft Passage','A title, not a document — recognised verbally, never written down, by the old families of the Undercroft. Grants safe passage through all territories.',  'title',    'epic',      'the-undercroft',  'Oral tradition only. No two accounts of its origin agree.'),
  ('The Keeper''s Key',         'Opens the lowest level of the Archive. Only one exists. The Archive has had exactly one Keeper at a time for as long as records go back.',                   'relic',    'legendary', 'the-archive',     'Passed Keeper to Keeper. Never lost. Never duplicated.'),
  ('Cloudspire Genesis Vote',   'Founding voting credential from Protocol Council v1.0. Symbolic now — the protocol has updated past any single vote mattering this much.',                  'title',    'rare',      'cloudspire',      'Issued to the thirty founding signatories.'),
  ('The Ruins Map',             'A partial map of The Ruins, hand-annotated by someone who clearly went deeper than anyone since. Most of it is illegible.',                                  'artifact', 'epic',      'the-ruins',       'Found, not made. Origin unknown.')
) AS v(name, description, asset_type, rarity, loc_slug, origin)
JOIN world_locations l ON l.slug = v.loc_slug
WHERE NOT EXISTS (SELECT 1 FROM scarce_assets sa WHERE sa.name = v.name);

-- ── 5. Visual Identity — extend factions + world_locations ──────────────────

ALTER TABLE factions
  ADD COLUMN IF NOT EXISTS motto             TEXT,
  ADD COLUMN IF NOT EXISTS sigil_description TEXT;

ALTER TABLE world_locations
  ADD COLUMN IF NOT EXISTS emblem_description TEXT,
  ADD COLUMN IF NOT EXISTS seal_motto          TEXT;

-- ── 6. Extend companion_offline_log entry types for new life events ─────────
-- Reuses the existing offline log / feed pipeline rather than duplicating it.

ALTER TABLE companion_offline_log DROP CONSTRAINT IF EXISTS companion_offline_log_entry_type_check;
ALTER TABLE companion_offline_log ADD CONSTRAINT companion_offline_log_entry_type_check
  CHECK (entry_type IN (
    'activity','social','discovery','goal_progress',
    'event_participation','location_change','mood_shift','relationship_change',
    'status_change','legend_declared','wealth_change','health_change',
    'skill_gained','addiction_developed','addiction_overcome','confidence_shift'
  ));

-- ── 7. Extend universe_jobs job_type for new tick types ──────────────────────

ALTER TABLE universe_jobs DROP CONSTRAINT IF EXISTS universe_jobs_job_type_check;
ALTER TABLE universe_jobs ADD CONSTRAINT universe_jobs_job_type_check
  CHECK (job_type IN (
    'governance_tick','economy_tick','companion_life',
    'event_generate','story_advance','reputation_update',
    'feed_build','election_process','law_vote',
    'trade_process','diplomatic_event','city_crisis',
    'faction_evolve','world_mood_update','full_universe_tick',
    'status_tick','legend_check','history_aggregate','visual_identity_backfill'
  ));

-- ── 8. World Timeline Function ────────────────────────────────────────────────
-- Aggregates existing history tables into one chronological feed.
-- No duplicated storage — "nothing is forgotten" by querying the sources of record.

CREATE OR REPLACE FUNCTION get_world_timeline(p_limit INTEGER DEFAULT 50, p_location_id UUID DEFAULT NULL)
RETURNS TABLE (
  source        TEXT,
  event_type    TEXT,
  title         TEXT,
  description   TEXT,
  location_id   UUID,
  significance  INTEGER,
  occurred_at   TIMESTAMPTZ
) AS $$
  SELECT 'universe_memory', memory_type, title, description, location_id, emotional_weight, occurred_at
  FROM universe_memory
  WHERE p_location_id IS NULL OR location_id = p_location_id

  UNION ALL

  SELECT 'political_events', event_type, title, description, location_id, severity, created_at
  FROM political_events
  WHERE p_location_id IS NULL OR location_id = p_location_id

  UNION ALL

  SELECT 'economic_events', event_type, title, description, location_id, severity, created_at
  FROM economic_events
  WHERE p_location_id IS NULL OR location_id = p_location_id

  UNION ALL

  SELECT 'world_events', event_type, title, description, location_id, emotional_weight, created_at
  FROM world_events
  WHERE p_location_id IS NULL OR location_id = p_location_id

  ORDER BY occurred_at DESC
  LIMIT p_limit;
$$ LANGUAGE sql STABLE;

-- ── 9. Character Biography Function ───────────────────────────────────────────
-- Aggregates a single companion's lived history across all systems.

-- NOTE: this is an interim definition. It only references tables/columns that
-- exist at this point in the migration sequence (companion_offline_log.content,
-- not the never-created career_events / event_character_reactions tables or the
-- nonexistent companion_offline_log.narrative column). 20240600_universe_fixes.sql
-- replaces this with a richer version once universe_memory.participants exists.
CREATE OR REPLACE FUNCTION get_character_biography(p_character_id UUID, p_limit INTEGER DEFAULT 40)
RETURNS TABLE (
  source        TEXT,
  description   TEXT,
  occurred_at   TIMESTAMPTZ
) AS $$
  SELECT 'life', content, occurred_at FROM companion_offline_log WHERE character_id = p_character_id
  ORDER BY occurred_at DESC
  LIMIT p_limit;
$$ LANGUAGE sql STABLE;

-- ── 10. RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE character_attributes ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_status        ENABLE ROW LEVEL SECURITY;
ALTER TABLE legends              ENABLE ROW LEVEL SECURITY;
ALTER TABLE scarce_assets        ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read_attributes"   ON character_attributes FOR SELECT USING (TRUE);
CREATE POLICY "public_read_status"       ON social_status        FOR SELECT USING (TRUE);
CREATE POLICY "public_read_legends"      ON legends              FOR SELECT USING (TRUE);
CREATE POLICY "public_read_assets"       ON scarce_assets        FOR SELECT USING (TRUE);

-- ── 11. DB Functions ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION adjust_character_attribute(
  p_character_id UUID,
  p_field        TEXT,
  p_delta        INTEGER
)
RETURNS void AS $$
BEGIN
  INSERT INTO character_attributes (character_id) VALUES (p_character_id)
  ON CONFLICT (character_id) DO NOTHING;

  IF p_field = 'health' THEN
    UPDATE character_attributes SET health = GREATEST(0, LEAST(100, health + p_delta)) WHERE character_id = p_character_id;
  ELSIF p_field = 'confidence' THEN
    UPDATE character_attributes SET confidence = GREATEST(0, LEAST(100, confidence + p_delta)) WHERE character_id = p_character_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION adjust_net_worth(
  p_character_id UUID,
  p_delta        BIGINT
)
RETURNS void AS $$
DECLARE v_new BIGINT;
BEGIN
  INSERT INTO character_attributes (character_id) VALUES (p_character_id)
  ON CONFLICT (character_id) DO NOTHING;

  UPDATE character_attributes
  SET net_worth = GREATEST(0, net_worth + p_delta)
  WHERE character_id = p_character_id
  RETURNING net_worth INTO v_new;

  UPDATE character_attributes
  SET wealth_tier = CASE
    WHEN v_new < 500     THEN 'destitute'
    WHEN v_new < 3000    THEN 'struggling'
    WHEN v_new < 15000   THEN 'modest'
    WHEN v_new < 75000   THEN 'comfortable'
    WHEN v_new < 400000  THEN 'wealthy'
    WHEN v_new < 2000000 THEN 'rich'
    ELSE                      'magnate'
  END
  WHERE character_id = p_character_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 12. Backfill character_attributes + social_status for existing companions ─

INSERT INTO character_attributes (character_id, net_worth)
SELECT c.id, 3000 + FLOOR(RANDOM() * 12000)
FROM characters c
WHERE c.active = TRUE
  AND NOT EXISTS (SELECT 1 FROM character_attributes ca WHERE ca.character_id = c.id);

INSERT INTO social_status (character_id, status_tier, status_score)
SELECT c.id, 'unknown_citizen', 0
FROM characters c
WHERE c.active = TRUE
  AND NOT EXISTS (SELECT 1 FROM social_status ss WHERE ss.character_id = c.id);

-- ── 13. Cron registration ──────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('legacy-tick', '0 */6 * * *', $cron$SELECT enqueue_universe_job('status_tick')$cron$);
  END IF;
END $$;

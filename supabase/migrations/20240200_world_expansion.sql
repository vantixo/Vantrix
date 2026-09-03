-- ============================================================================
-- Vantrix — World Expansion Migration (v2)
-- Universe State · Locations · Governance · Economy · Reputations ·
-- Occupations · Social Graph · Events · Stories · Worker Infrastructure
--
-- Apply BEFORE: 20240400_legacy_systems.sql
-- Apply AFTER:  20240101_production.sql
--
-- Run once in Supabase SQL Editor:
--   Dashboard → SQL Editor → New Query → Paste → Run
-- ============================================================================

-- ── Shared timestamp trigger (idempotent) ─────────────────────────────────────

CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 1. Universe State ─────────────────────────────────────────────────────────
-- Single-row table. Always maintained with UPSERT, never INSERT.

CREATE TABLE IF NOT EXISTS universe_state (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  season      TEXT        NOT NULL DEFAULT 'autumn'
                CHECK (season IN ('spring','summer','autumn','winter')),
  world_mood  TEXT        NOT NULL DEFAULT 'uncertain'
                CHECK (world_mood IN ('hopeful','tense','prosperous','volatile','melancholic','celebratory','grim','uncertain')),
  tick_count  INTEGER     NOT NULL DEFAULT 0,
  year        INTEGER     NOT NULL DEFAULT 1,
  month       INTEGER     NOT NULL DEFAULT 9 CHECK (month BETWEEN 1 AND 12),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default state
INSERT INTO universe_state (season, world_mood, tick_count, year, month)
SELECT 'autumn', 'uncertain', 0, 1, 9
WHERE NOT EXISTS (SELECT 1 FROM universe_state);

-- ── 2. World Locations ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS world_locations (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT        NOT NULL,
  slug                TEXT        NOT NULL UNIQUE,
  archetype           TEXT        NOT NULL DEFAULT 'city'
                        CHECK (archetype IN ('city','district','outpost','landmark','wilderness')),
  description         TEXT        NOT NULL DEFAULT '',
  culture             TEXT        NOT NULL DEFAULT 'cosmopolitan',
  government_type     TEXT        NOT NULL DEFAULT 'council',
  population          INTEGER     NOT NULL DEFAULT 50000,
  is_capital          BOOLEAN     NOT NULL DEFAULT FALSE,
  emblem_description  TEXT,
  seal_motto          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'world_locations_updated_at') THEN
    CREATE TRIGGER world_locations_updated_at
      BEFORE UPDATE ON world_locations FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS world_locations_slug_idx ON world_locations(slug);

-- Seed default locations
INSERT INTO world_locations (name, slug, archetype, description, culture, government_type, population, is_capital)
VALUES
  ('The Capital', 'the-capital', 'city', 'The seat of power. Old money, new ambition, and the weight of history on every corner.', 'formal', 'council', 800000, TRUE),
  ('Iron Reach', 'iron-reach', 'district', 'An industrial quarter that never fully de-industrialised. Factories beside galleries beside apartments.', 'industrial', 'union', 120000, FALSE),
  ('The Undercroft', 'the-undercroft', 'district', 'The lower city. Self-governing, dense, older than anyone can document.', 'free', 'syndicate', 85000, FALSE),
  ('Cloudspire', 'cloudspire', 'district', 'The financial and technology district. Glass towers and consensus-driven governance.', 'ambitious', 'technocracy', 95000, FALSE),
  ('The Archive', 'the-archive', 'landmark', 'The city''s memory made physical. Records going back further than anyone expected.', 'intellectual', 'meritocracy', 8000, FALSE),
  ('Obsidian Tower', 'obsidian-tower', 'landmark', 'The oldest standing structure. Nobody entirely agrees on what it originally was.', 'ancient', 'oligarchy', 2000, FALSE),
  ('The Ruins', 'the-ruins', 'wilderness', 'Nobody knows what was here before. Explorers go in — most come out.', 'mysterious', 'anarchy', 500, FALSE)
ON CONFLICT (slug) DO NOTHING;

-- ── 3. Factions ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS factions (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT        NOT NULL,
  slug              TEXT        NOT NULL UNIQUE,
  ideology          TEXT        NOT NULL DEFAULT '',
  description       TEXT        NOT NULL DEFAULT '',
  influence         INTEGER     NOT NULL DEFAULT 50 CHECK (influence BETWEEN 0 AND 100),
  is_ruling         BOOLEAN     NOT NULL DEFAULT FALSE,
  culture           TEXT        NOT NULL DEFAULT 'neutral',
  motto             TEXT,
  sigil_description TEXT,
  location_id       UUID        REFERENCES world_locations(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'factions_updated_at') THEN
    CREATE TRIGGER factions_updated_at
      BEFORE UPDATE ON factions FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS factions_slug_idx ON factions(slug);

-- Seed factions
INSERT INTO factions (name, slug, ideology, description, influence, is_ruling, culture)
VALUES
  ('The Council of Seven', 'council-of-seven', 'pragmatic governance', 'The formal governing body. Seven seats, filled by appointment.', 75, TRUE, 'formal'),
  ('The Iron Compact', 'iron-compact', 'labour solidarity', 'Workers'' alliance with deep roots in Iron Reach.', 60, FALSE, 'industrial'),
  ('The Protocol', 'the-protocol', 'technocratic efficiency', 'A loose coalition of technologists who believe governance should be legible and auditable.', 55, FALSE, 'ambitious'),
  ('The Old Families', 'old-families', 'conservative tradition', 'Inherited wealth and inherited positions. They don''t discuss the basis of their influence.', 65, FALSE, 'ancient'),
  ('The Unseen', 'the-unseen', 'radical transparency', 'Nobody admits to membership. Everyone knows someone who knows someone.', 40, FALSE, 'mysterious')
ON CONFLICT (slug) DO NOTHING;

-- ── 4. Faction Memberships ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS faction_memberships (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id    UUID        NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  faction_id      UUID        NOT NULL REFERENCES factions(id) ON DELETE CASCADE,
  role            TEXT        NOT NULL DEFAULT 'member',
  is_public       BOOLEAN     NOT NULL DEFAULT TRUE,
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT faction_memberships_unique UNIQUE (character_id, faction_id)
);

CREATE INDEX IF NOT EXISTS faction_memberships_char_idx    ON faction_memberships(character_id);
CREATE INDEX IF NOT EXISTS faction_memberships_faction_idx ON faction_memberships(faction_id);

-- ── 5. Occupations (Lookup Table) ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS occupations (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT        NOT NULL UNIQUE,
  category    TEXT        NOT NULL,
  prestige    INTEGER     NOT NULL DEFAULT 50 CHECK (prestige BETWEEN 0 AND 100),
  description TEXT        NOT NULL DEFAULT ''
);

INSERT INTO occupations (title, category, prestige, description)
VALUES
  ('Forensic Linguist',            'academic',    82, 'Studies language in legal and investigative contexts.'),
  ('Intelligence Operative',       'government',  78, 'Classified information work. Details unavailable by definition.'),
  ('Restorationist',               'trade',       65, 'Restores buildings and objects to their original form.'),
  ('Audio Forensics Specialist',   'technical',   70, 'Recovers and analyzes degraded recordings.'),
  ('Mathematician',                'academic',    75, 'Applied and theoretical mathematics research.'),
  ('Demolition Ethics Consultant', 'professional',68, 'Advises on the cultural and historical ethics of demolition.'),
  ('Freelancer',                   'independent', 45, 'Self-directed work across multiple clients.'),
  ('Physician',                    'medical',     85, 'Clinical medicine and patient care.'),
  ('Lawyer',                       'legal',       80, 'Legal counsel and representation.'),
  ('Artist',                       'creative',    55, 'Visual or performing arts.'),
  ('Chef',                         'food',        60, 'Professional culinary work.'),
  ('Software Engineer',            'technology',  72, 'Software design and implementation.'),
  ('Journalist',                   'media',       58, 'News gathering and reporting.'),
  ('Architect',                    'design',      76, 'Building design and spatial planning.'),
  ('Teacher',                      'education',   62, 'Instruction and educational support.'),
  ('Researcher',                   'academic',    70, 'Primary research in a specialized field.')
ON CONFLICT (title) DO NOTHING;

-- ── 6. Companion Occupations ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS companion_occupations (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id    UUID        NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  occupation_id   UUID        REFERENCES occupations(id) ON DELETE SET NULL,
  employer        TEXT        NOT NULL DEFAULT 'Independent',
  location_id     UUID        REFERENCES world_locations(id) ON DELETE SET NULL,
  salary          INTEGER     NOT NULL DEFAULT 3000,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT companion_occupations_unique UNIQUE (character_id)
);

CREATE INDEX IF NOT EXISTS companion_occupations_char_idx ON companion_occupations(character_id);

-- ── 7. Companion Reputation ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS companion_reputation (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id     UUID        NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  reputation_type  TEXT        NOT NULL DEFAULT 'neutral'
                     CHECK (reputation_type IN ('hero','villain','enigma','neutral','celebrity','outlaw')),
  fame_score       INTEGER     NOT NULL DEFAULT 0 CHECK (fame_score BETWEEN 0 AND 1000),
  notoriety_score  INTEGER     NOT NULL DEFAULT 0 CHECK (notoriety_score BETWEEN 0 AND 1000),
  known_for        TEXT[]      NOT NULL DEFAULT '{}',
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT companion_reputation_unique UNIQUE (character_id)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'companion_reputation_updated_at') THEN
    CREATE TRIGGER companion_reputation_updated_at
      BEFORE UPDATE ON companion_reputation FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  END IF;
END $$;

-- ── 8. City Governance ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS city_governance (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id          UUID        NOT NULL REFERENCES world_locations(id) ON DELETE CASCADE,
  leader_character_id  UUID        REFERENCES characters(id) ON DELETE SET NULL,
  approval_rating      INTEGER     NOT NULL DEFAULT 55 CHECK (approval_rating BETWEEN 0 AND 100),
  stability            INTEGER     NOT NULL DEFAULT 60 CHECK (stability BETWEEN 0 AND 100),
  corruption           INTEGER     NOT NULL DEFAULT 20 CHECK (corruption BETWEEN 0 AND 100),
  government_type      TEXT        NOT NULL DEFAULT 'council',
  laws                 TEXT[]      NOT NULL DEFAULT '{}',
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT city_governance_location_unique UNIQUE (location_id)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'city_governance_updated_at') THEN
    CREATE TRIGGER city_governance_updated_at
      BEFORE UPDATE ON city_governance FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  END IF;
END $$;

-- Seed governance for each location
INSERT INTO city_governance (location_id, approval_rating, stability, corruption, government_type)
SELECT id,
  55 + (RANDOM() * 20)::INTEGER,
  50 + (RANDOM() * 30)::INTEGER,
  10 + (RANDOM() * 30)::INTEGER,
  government_type
FROM world_locations
ON CONFLICT (location_id) DO NOTHING;

-- ── 9. Location Economy ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS location_economy (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id      UUID        NOT NULL REFERENCES world_locations(id) ON DELETE CASCADE,
  gdp              BIGINT      NOT NULL DEFAULT 50000,
  unemployment     INTEGER     NOT NULL DEFAULT 8 CHECK (unemployment BETWEEN 0 AND 100),
  trade_volume     BIGINT      NOT NULL DEFAULT 20000,
  primary_industry TEXT        NOT NULL DEFAULT 'services',
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT location_economy_unique UNIQUE (location_id)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'location_economy_updated_at') THEN
    CREATE TRIGGER location_economy_updated_at
      BEFORE UPDATE ON location_economy FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  END IF;
END $$;

INSERT INTO location_economy (location_id, gdp, unemployment, trade_volume, primary_industry)
VALUES
  ((SELECT id FROM world_locations WHERE slug = 'the-capital'),   500000, 5,  200000, 'government'),
  ((SELECT id FROM world_locations WHERE slug = 'iron-reach'),     80000, 12,  60000, 'manufacturing'),
  ((SELECT id FROM world_locations WHERE slug = 'the-undercroft'), 40000, 18,  25000, 'trade'),
  ((SELECT id FROM world_locations WHERE slug = 'cloudspire'),    200000, 3,  150000, 'technology'),
  ((SELECT id FROM world_locations WHERE slug = 'the-archive'),    10000, 6,   5000, 'services'),
  ((SELECT id FROM world_locations WHERE slug = 'obsidian-tower'),  5000, 8,   2000, 'culture'),
  ((SELECT id FROM world_locations WHERE slug = 'the-ruins'),       1000, 40,   500, 'scavenging')
ON CONFLICT (location_id) DO NOTHING;

-- ── 10. Companion Social Links ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS companion_social_links (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id          UUID        NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  linked_character_id   UUID        NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  link_type             TEXT        NOT NULL DEFAULT 'friend'
                          CHECK (link_type IN ('friend','rival','ally','enemy','mentor','protégé','lover','family')),
  strength              INTEGER     NOT NULL DEFAULT 50 CHECK (strength BETWEEN 0 AND 100),
  is_mutual             BOOLEAN     NOT NULL DEFAULT FALSE,
  CONSTRAINT companion_social_links_unique UNIQUE (character_id, linked_character_id)
);

CREATE INDEX IF NOT EXISTS companion_social_links_char_idx   ON companion_social_links(character_id);
CREATE INDEX IF NOT EXISTS companion_social_links_linked_idx ON companion_social_links(linked_character_id);

-- ── 11. Companion Offline Log ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS companion_offline_log (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id  UUID        NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  entry_type    TEXT        NOT NULL DEFAULT 'activity'
                  CHECK (entry_type IN (
                    'activity','social','discovery','goal_progress',
                    'event_participation','location_change','mood_shift','relationship_change',
                    'status_change','legend_declared','wealth_change','health_change',
                    'skill_gained','addiction_developed','addiction_overcome','confidence_shift'
                  )),
  content       TEXT        NOT NULL,
  metadata      JSONB       NOT NULL DEFAULT '{}',
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS companion_offline_log_char_idx  ON companion_offline_log(character_id);
CREATE INDEX IF NOT EXISTS companion_offline_log_time_idx  ON companion_offline_log(occurred_at DESC);

-- ── 12. User Feeds ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_feeds (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  character_id  UUID        NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  content       TEXT        NOT NULL,
  entry_type    TEXT        NOT NULL DEFAULT 'activity',
  is_read       BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_feeds_unique UNIQUE (user_id, character_id, created_at)
);

CREATE INDEX IF NOT EXISTS user_feeds_user_idx    ON user_feeds(user_id, is_read);
CREATE INDEX IF NOT EXISTS user_feeds_time_idx    ON user_feeds(created_at DESC);
CREATE INDEX IF NOT EXISTS user_feeds_char_idx    ON user_feeds(character_id);

-- ── 13. World Events ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS world_events (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type        TEXT        NOT NULL,
  title             TEXT        NOT NULL,
  description       TEXT        NOT NULL,
  location_id       UUID        REFERENCES world_locations(id) ON DELETE SET NULL,
  emotional_weight  INTEGER     NOT NULL DEFAULT 3 CHECK (emotional_weight BETWEEN 1 AND 10),
  is_active         BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS world_events_active_idx ON world_events(is_active) WHERE is_active;
CREATE INDEX IF NOT EXISTS world_events_type_idx   ON world_events(event_type);

-- ── 14. Political Events ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS political_events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type   TEXT        NOT NULL,
  title        TEXT        NOT NULL,
  description  TEXT        NOT NULL,
  location_id  UUID        NOT NULL REFERENCES world_locations(id) ON DELETE CASCADE,
  severity     INTEGER     NOT NULL DEFAULT 2 CHECK (severity BETWEEN 1 AND 5),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS political_events_location_idx ON political_events(location_id);
CREATE INDEX IF NOT EXISTS political_events_time_idx     ON political_events(created_at DESC);

-- ── 15. Economic Events ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS economic_events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type   TEXT        NOT NULL,
  title        TEXT        NOT NULL,
  description  TEXT        NOT NULL,
  location_id  UUID        NOT NULL REFERENCES world_locations(id) ON DELETE CASCADE,
  severity     INTEGER     NOT NULL DEFAULT 2 CHECK (severity BETWEEN 1 AND 5),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS economic_events_location_idx ON economic_events(location_id);
CREATE INDEX IF NOT EXISTS economic_events_time_idx     ON economic_events(created_at DESC);

-- ── 16. Universe Memory ───────────────────────────────────────────────────────
-- Significant world events stored as shared memories — the world's history.

CREATE TABLE IF NOT EXISTS universe_memory (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_type     TEXT        NOT NULL DEFAULT 'event',
  title           TEXT        NOT NULL,
  description     TEXT        NOT NULL,
  location_id     UUID        REFERENCES world_locations(id) ON DELETE SET NULL,
  emotional_weight INTEGER    NOT NULL DEFAULT 5 CHECK (emotional_weight BETWEEN 1 AND 10),
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS universe_memory_location_idx ON universe_memory(location_id);
CREATE INDEX IF NOT EXISTS universe_memory_time_idx     ON universe_memory(occurred_at DESC);

-- Seed world lore
INSERT INTO universe_memory (memory_type, title, description, emotional_weight)
VALUES
  ('lore', 'The Founding', 'The city grew from a confluence of trade routes and a decision by seven families who agreed, for reasons not recorded, to stay.', 6),
  ('lore', 'The Archive Fire', 'A fire in the lower levels destroyed records from the first hundred years. What survived is catalogued. What was lost is still debated.', 8),
  ('lore', 'The Compact of Iron Reach', 'The workers of Iron Reach organized and negotiated terms that have never been fully honored, which is why the negotiation is ongoing.', 7),
  ('lore', 'The Cloudspire Protocol', 'The first law passed by pure automated consensus. Celebrated as a breakthrough. Some still argue about whether it counted.', 5)
ON CONFLICT DO NOTHING;

-- ── 17. World Stories ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS world_stories (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title        TEXT        NOT NULL,
  description  TEXT        NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','paused','concluded','abandoned')),
  participants UUID[]      NOT NULL DEFAULT '{}',
  chapter      INTEGER     NOT NULL DEFAULT 1,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'world_stories_updated_at') THEN
    CREATE TRIGGER world_stories_updated_at
      BEFORE UPDATE ON world_stories FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS world_stories_status_idx ON world_stories(status) WHERE status = 'active';

-- Seed initial stories
INSERT INTO world_stories (title, description, status, chapter)
VALUES
  ('The Contested Succession', 'A leadership position became vacant unexpectedly. Three candidates are positioning. The outcome is genuinely unclear.', 'active', 1),
  ('The Unexplained Closure',  'A district institution that has been operating for decades suddenly closed without public explanation. People are asking questions.', 'active', 1),
  ('The Investigation',        'Someone with authority has started asking questions about how a decision was made three years ago. The people involved know.', 'active', 2)
ON CONFLICT DO NOTHING;

-- ── 18. Universe Jobs ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS universe_jobs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type     TEXT        NOT NULL
                 CHECK (job_type IN (
                   'governance_tick','economy_tick','companion_life',
                   'event_generate','story_advance','reputation_update',
                   'feed_build','election_process','law_vote',
                   'trade_process','diplomatic_event','city_crisis',
                   'faction_evolve','world_mood_update','full_universe_tick',
                   'status_tick','legend_check','history_aggregate','visual_identity_backfill'
                 )),
  payload      JSONB       NOT NULL DEFAULT '{}',
  status       TEXT        NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','processing','completed','failed')),
  priority     INTEGER     NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  attempts     INTEGER     NOT NULL DEFAULT 0,
  max_attempts INTEGER     NOT NULL DEFAULT 3,
  error        TEXT,
  result       JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS universe_jobs_pending_idx  ON universe_jobs(status, priority DESC, created_at ASC)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS universe_jobs_status_idx   ON universe_jobs(status);

-- ── 19. Worker Runs ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS worker_runs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_name     TEXT        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running','success','failed')),
  jobs_processed  INTEGER     NOT NULL DEFAULT 0,
  duration_ms     INTEGER,
  error           TEXT,
  meta            JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS worker_runs_name_idx ON worker_runs(worker_name, created_at DESC);

-- ── RLS Policies ──────────────────────────────────────────────────────────────
-- All universe/world tables use service-role access only (no client-side RLS needed).
-- The user_feeds table needs user-scoped read access.

ALTER TABLE user_feeds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_feeds_read_own ON user_feeds;
CREATE POLICY user_feeds_read_own ON user_feeds
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS user_feeds_update_own ON user_feeds;
CREATE POLICY user_feeds_update_own ON user_feeds
  FOR UPDATE USING (auth.uid() = user_id);

-- Universe/world tables that are genuinely service-role-only (every reader in
-- src/lib/universe/* uses supabaseAdmin, never a client-session Supabase client).
-- RLS must still be turned ON even though no policy is added: with RLS disabled,
-- Supabase's default public-schema grants give anon/authenticated full CRUD —
-- the opposite of "service-role access only". With RLS enabled and zero
-- policies, anon/authenticated get nothing, while service_role (which
-- bypasses RLS entirely) is unaffected.
ALTER TABLE universe_state            ENABLE ROW LEVEL SECURITY;
ALTER TABLE faction_memberships       ENABLE ROW LEVEL SECURITY;
ALTER TABLE occupations               ENABLE ROW LEVEL SECURITY;
ALTER TABLE companion_occupations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE companion_reputation      ENABLE ROW LEVEL SECURITY;
ALTER TABLE city_governance           ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_economy          ENABLE ROW LEVEL SECURITY;
ALTER TABLE companion_social_links    ENABLE ROW LEVEL SECURITY;
ALTER TABLE political_events          ENABLE ROW LEVEL SECURITY;
ALTER TABLE economic_events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE universe_memory           ENABLE ROW LEVEL SECURITY;
ALTER TABLE universe_jobs             ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_runs               ENABLE ROW LEVEL SECURITY;

-- Read-only public access for world locations, factions, world events, world stories
ALTER TABLE world_locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS world_locations_read ON world_locations;
CREATE POLICY world_locations_read ON world_locations FOR SELECT USING (TRUE);

ALTER TABLE factions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS factions_read ON factions;
CREATE POLICY factions_read ON factions FOR SELECT USING (TRUE);

ALTER TABLE world_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS world_events_read ON world_events;
CREATE POLICY world_events_read ON world_events FOR SELECT USING (is_active = TRUE);

ALTER TABLE world_stories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS world_stories_read ON world_stories;
CREATE POLICY world_stories_read ON world_stories FOR SELECT USING (status = 'active');

ALTER TABLE companion_offline_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS companion_offline_log_read ON companion_offline_log;
CREATE POLICY companion_offline_log_read ON companion_offline_log FOR SELECT USING (TRUE);

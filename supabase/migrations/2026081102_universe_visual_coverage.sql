-- Vantrix — Universe Visual Coverage
-- ─────────────────────────────────────────────────────────────────────────────
-- Problem: characters already have image_url/canon_sheet_url, but
-- world_locations (cities/districts/towns) and factions have zero visual
-- representation — every reference to them anywhere in the app (Universe
-- hub, location detail, faction detail, chat context cards) is text-only.
-- This migration adds the columns needed so those entities can carry a
-- generated image the same way characters already do, and adds a table to
-- store composite multi-character "scenes" (a location + faction + cast of
-- characters + genre, rendered as one image and optionally a video) so
-- those aren't regenerated on every view.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE world_locations
  ADD COLUMN IF NOT EXISTS image_url  TEXT,
  ADD COLUMN IF NOT EXISTS image_generated_at TIMESTAMPTZ;

ALTER TABLE factions
  ADD COLUMN IF NOT EXISTS image_url  TEXT,
  ADD COLUMN IF NOT EXISTS image_generated_at TIMESTAMPTZ;

-- ── Universe Scenes ──────────────────────────────────────────────────────────
-- A generated "full scene": a specific location, optionally a faction, a
-- cast of characters, and a genre/mood, rendered as one composite image and
-- (optionally) an animated video derived from it.

CREATE TABLE IF NOT EXISTS universe_scenes (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id   UUID        REFERENCES world_locations(id) ON DELETE SET NULL,
  faction_id    UUID        REFERENCES factions(id) ON DELETE SET NULL,
  character_ids UUID[]      NOT NULL DEFAULT '{}',
  genre         TEXT        NOT NULL,
  scene_prompt  TEXT        NOT NULL,
  image_url     TEXT,
  video_url     TEXT,
  status        TEXT        NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','generating_image','generating_video','complete','failed')),
  error         TEXT,
  created_by    UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'universe_scenes_updated_at') THEN
    CREATE TRIGGER universe_scenes_updated_at
      BEFORE UPDATE ON universe_scenes FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS universe_scenes_location_idx ON universe_scenes(location_id);
CREATE INDEX IF NOT EXISTS universe_scenes_faction_idx  ON universe_scenes(faction_id);
CREATE INDEX IF NOT EXISTS universe_scenes_status_idx   ON universe_scenes(status);

-- Readable by anyone (same as world_locations/factions — Universe content is
-- public browse), writable only by the service role (all writes go through
-- scene-composer.ts using supabaseAdmin, never a user-scoped client).
ALTER TABLE universe_scenes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'universe_scenes' AND policyname = 'universe_scenes_select_all') THEN
    CREATE POLICY universe_scenes_select_all ON universe_scenes FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'universe_scenes' AND policyname = 'universe_scenes_service_write') THEN
    CREATE POLICY universe_scenes_service_write ON universe_scenes FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

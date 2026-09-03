-- ─────────────────────────────────────────────────────────────────────────────
-- Location Hierarchy + Wing Residency Fix
--
-- Two independent problems, fixed together because they were diagnosed
-- together while auditing residency distribution across world_locations:
--
--   (a) The 14 "Wing of..." sub-locations seeded by
--       20260825_archive_of_echoes_universe_integration.sql are conceptually
--       sub-districts of The Archive, but world_locations had no way to
--       express that relationship. Adds parent_location_id so the app layer
--       (getLocationResidents in world-atlas.ts) can fall back to a parent
--       location's residents when a Wing has none of its own directly
--       assigned — instead of rendering an empty Residents section.
--
--   (b) That same 20260825 migration's _wing_seed loop inserts each named
--       Echo character's companion_occupations row with
--       "ON CONFLICT (character_id) DO NOTHING". If provisioning.ts's
--       generic provisionOccupation() had already run for that character
--       (e.g. at character-creation time, before this migration/backfill
--       ran) and inserted a *generic* location (the-capital / cloudspire /
--       iron-reach — provisionOccupation never targeted Wings at all), the
--       wing-seed's correct, named-character location assignment was
--       silently dropped by the conflict guard. Net effect: several Wings
--       that should have had residents from the 20260825 seed ended up
--       with none. This section re-applies the same char→Wing mapping as
--       an UPDATE so it wins regardless of ordering, idempotent to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. parent_location_id ────────────────────────────────────────────────────

ALTER TABLE world_locations
  ADD COLUMN IF NOT EXISTS parent_location_id UUID REFERENCES world_locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS world_locations_parent_idx ON world_locations(parent_location_id);

UPDATE world_locations child
SET parent_location_id = parent.id
FROM world_locations parent
WHERE parent.slug = 'the-archive'
  AND child.slug IN (
    'wing-of-the-root', 'wing-of-the-drowned-court', 'wing-of-the-long-sky',
    'wing-of-the-ash-camps', 'wing-of-hidden-names', 'wing-of-the-fallen-stair',
    'wing-of-the-crack', 'wing-of-the-crossroads', 'wing-of-between-light',
    'wing-of-the-storm-wall', 'wing-of-the-long-market', 'the-ashen-cloister',
    'the-fourth-wall-wing', 'the-research-wing'
  )
  AND child.parent_location_id IS NULL;

-- ── 2. Re-apply the char → Wing residency mapping as an UPDATE ─────────────
-- Mirrors _wing_seed's (char_name, loc_slug) pairs from
-- 20260825_archive_of_echoes_universe_integration.sql. Only moves rows that
-- exist and are pointed somewhere other than their intended Wing — never
-- touches characters who were never part of that seed.

DO $$
DECLARE
  v_char_id UUID;
  v_loc_id  UUID;
  r RECORD;
BEGIN
  CREATE TEMP TABLE _wing_residency_fix (char_name TEXT, loc_slug TEXT) ON COMMIT DROP;
  INSERT INTO _wing_residency_fix (char_name, loc_slug) VALUES
    ('Aurelian',          'wing-of-the-root'),
    ('Seraphine Vale',    'wing-of-the-drowned-court'),
    ('Kael Ember',        'wing-of-the-drowned-court'),
    ('Lyra Starborn',     'wing-of-the-long-sky'),
    ('Astra Nocturne',    'wing-of-the-long-sky'),
    ('Orion Black',       'wing-of-the-ash-camps'),
    ('Morrow Ash',        'wing-of-the-ash-camps'),
    ('Cassian Rune',      'wing-of-hidden-names'),
    ('Evelyn Thorn',      'wing-of-the-fallen-stair'),
    ('Mira Glass',        'wing-of-the-crack'),
    ('Nyx',                'wing-of-the-crossroads'),
    ('Selene Dusk',       'wing-of-between-light'),
    ('Valeria Storm',     'wing-of-the-storm-wall'),
    ('Vesper Quinn',      'wing-of-the-long-market'),
    ('Brother Corvin',    'the-ashen-cloister'),
    ('The Archivist Child', 'the-fourth-wall-wing'),
    ('The Clockmaker',    'the-fourth-wall-wing'),
    ('The Ferryman',      'the-fourth-wall-wing'),
    ('Dr. Elias Voss',    'the-research-wing');

  FOR r IN SELECT * FROM _wing_residency_fix LOOP
    SELECT id INTO v_char_id FROM characters WHERE name = r.char_name LIMIT 1;
    CONTINUE WHEN v_char_id IS NULL;

    SELECT id INTO v_loc_id FROM world_locations WHERE slug = r.loc_slug LIMIT 1;
    CONTINUE WHEN v_loc_id IS NULL;

    UPDATE companion_occupations
    SET location_id = v_loc_id
    WHERE character_id = v_char_id
      AND location_id IS DISTINCT FROM v_loc_id;

    -- Character was provisioned in every other respect but somehow has no
    -- companion_occupations row at all yet — insert one rather than leaving
    -- them homeless (mirrors provisionOccupation's own insert shape).
    INSERT INTO companion_occupations (character_id, employer, location_id, salary)
    SELECT v_char_id, 'Independent', v_loc_id, 4000
    WHERE NOT EXISTS (
      SELECT 1 FROM companion_occupations WHERE character_id = v_char_id
    );
  END LOOP;
END $$;

-- ============================================================================
-- Connect canon characters to the living universe simulation
--
-- THE GAP: 20260701_seed_launch_characters.sql and 20260714_seed_visual_
-- characters.sql insert 21 characters (is_canon = TRUE) into `characters`,
-- but never touch a single universe join table. As a result every one of
-- those characters is chattable but otherwise inert:
--
--   • character_attributes  — never created. character-evolution.ts calls
--     .update() on this table (not upsert), so for any character missing a
--     row here, skill growth / wealth changes / confidence shifts silently
--     no-op forever (Supabase resolves a 0-row UPDATE without error).
--   • companion_occupations — never created. companion-jobs.ts, life-engine
--     .ts (location lookups) and governance.ts all read this and find
--     nothing for these characters.
--   • faction_memberships   — never created. world-atlas.ts's per-faction
--     roster and per-location faction list are built from this table.
--   • companion_reputation  — never created. reputation.ts has nothing to
--     read or evolve.
--   • social_status         — never created. status-legend.ts's tier/legend
--     logic depends on it.
--   • companion_social_links — never created. social-graph.ts has an empty
--     graph for every canon character.
--
-- This migration seeds all six for every existing is_canon character that
-- does not already have a row, using their existing `occupation`, `archetype`
-- and `tags` fields (already-written prose, not new invented facts) to pick
-- a sensible faction, location, starting wealth, and reputation. It also
-- generically covers any *future* character marked is_canon = TRUE the next
-- time this logic is re-run in the app layer (see note at the bottom).
-- ============================================================================

-- ── 1. Character Attributes (the deep simulation layer) ─────────────────────
INSERT INTO character_attributes (character_id, health, confidence, net_worth, wealth_tier, skills, political_view)
SELECT
  c.id,
  85,
  CASE
    WHEN c.tags::text ILIKE ANY (ARRAY['%bold%','%confident%','%commanding%']) THEN 75
    WHEN c.tags::text ILIKE ANY (ARRAY['%shy%','%guarded%','%withdrawn%'])     THEN 45
    ELSE 60
  END,
  CASE
    WHEN c.name IN ('Countess Vesper', 'Lord Adrian')                              THEN 250000
    WHEN c.tags::text ILIKE ANY (ARRAY['%noble%','%aristocrat%','%royal%'])        THEN 180000
    WHEN c.occupation ILIKE ANY (ARRAY['%doctor%','%physician%','%lawyer%'])       THEN 90000
    WHEN c.occupation ILIKE ANY (ARRAY['%professor%','%engineer%','%architect%'])  THEN 60000
    ELSE 15000
  END,
  CASE
    WHEN c.name IN ('Countess Vesper', 'Lord Adrian')                              THEN 'wealthy'
    WHEN c.tags::text ILIKE ANY (ARRAY['%noble%','%aristocrat%','%royal%'])        THEN 'wealthy'
    WHEN c.occupation ILIKE ANY (ARRAY['%doctor%','%physician%','%lawyer%'])       THEN 'comfortable'
    WHEN c.occupation ILIKE ANY (ARRAY['%professor%','%engineer%','%architect%'])  THEN 'comfortable'
    ELSE 'modest'
  END,
  '{}'::jsonb,
  'undeclared'
FROM characters c
WHERE c.is_canon = TRUE
ON CONFLICT (character_id) DO NOTHING;

-- ── 2. Companion Occupations (job, employer, home location) ─────────────────
INSERT INTO companion_occupations (character_id, occupation_id, employer, location_id, salary)
SELECT
  c.id,
  (
    SELECT o.id FROM occupations o
    WHERE c.occupation ILIKE '%' || o.title || '%'
       OR c.occupation ILIKE '%' || split_part(o.title, ' ', 1) || '%'
    ORDER BY o.prestige DESC
    LIMIT 1
  ),
  COALESCE(NULLIF(trim(split_part(c.occupation, ',', 1)), ''), 'Independent'),
  COALESCE(
    (
      SELECT wl.id FROM world_locations wl
      WHERE
           (c.tags::text ILIKE ANY (ARRAY['%academic%','%scholar%']) OR c.occupation ILIKE ANY (ARRAY['%professor%','%research%','%librarian%'])) AND wl.slug = 'the-archive'
        OR (c.name IN ('Countess Vesper','Lord Adrian') OR c.tags::text ILIKE ANY (ARRAY['%noble%','%aristocrat%','%royal%','%ancient%'])) AND wl.slug = 'obsidian-tower'
        OR (c.occupation ILIKE ANY (ARRAY['%engineer%','%tech%','%software%','%analyst%'])) AND wl.slug = 'cloudspire'
        OR (c.tags::text ILIKE ANY (ARRAY['%mysterious%','%witch%','%occult%','%enigma%','%ghost%'])) AND wl.slug = 'the-undercroft'
        OR (c.occupation ILIKE ANY (ARRAY['%chef%','%restaurant%','%trade%','%craft%'])) AND wl.slug = 'iron-reach'
      LIMIT 1
    ),
    (SELECT id FROM world_locations WHERE slug = 'the-capital')
  ),
  3000 + (RANDOM() * 4000)::INT
FROM characters c
WHERE c.is_canon = TRUE
ON CONFLICT (character_id) DO NOTHING;

-- ── 3. Faction Memberships ────────────────────────────────────────────────────
INSERT INTO faction_memberships (character_id, faction_id, role, is_public)
SELECT
  c.id,
  COALESCE(
    (
      SELECT f.id FROM factions f
      WHERE
           c.tags::text ILIKE ANY (ARRAY['%witch%','%mysterious%','%occult%','%enigma%','%ghost%','%secret%']) AND f.slug = 'the-unseen'
        OR (c.name IN ('Countess Vesper','Lord Adrian') OR c.tags::text ILIKE ANY (ARRAY['%noble%','%aristocrat%','%royal%'])) AND f.slug = 'old-families'
        OR c.occupation ILIKE ANY (ARRAY['%engineer%','%tech%','%scientist%','%software%','%analyst%']) AND f.slug = 'the-protocol'
        OR c.occupation ILIKE ANY (ARRAY['%chef%','%trade%','%craft%','%worker%']) AND f.slug = 'iron-compact'
      LIMIT 1
    ),
    (SELECT id FROM factions WHERE slug = 'council-of-seven')
  ),
  'member',
  TRUE
FROM characters c
WHERE c.is_canon = TRUE
ON CONFLICT (character_id, faction_id) DO NOTHING;

-- ── 4. Companion Reputation ───────────────────────────────────────────────────
INSERT INTO companion_reputation (character_id, reputation_type, fame_score, notoriety_score, known_for)
SELECT
  c.id,
  CASE
    WHEN c.tags::text ILIKE ANY (ARRAY['%villain%','%dark%','%outlaw%'])            THEN 'villain'
    WHEN c.tags::text ILIKE ANY (ARRAY['%mysterious%','%ancient%','%ghost%','%enigma%']) THEN 'enigma'
    WHEN c.tags::text ILIKE ANY (ARRAY['%hero%','%protector%','%guardian%'])        THEN 'hero'
    WHEN c.is_featured                                                              THEN 'celebrity'
    ELSE 'neutral'
  END,
  CASE WHEN c.is_featured THEN 120 + (RANDOM() * 80)::INT ELSE 30 + (RANDOM() * 60)::INT END,
  CASE WHEN c.tags::text ILIKE ANY (ARRAY['%outlaw%','%dark%','%villain%']) THEN 40 + (RANDOM() * 60)::INT ELSE (RANDOM() * 20)::INT END,
  COALESCE(c.tags[1:3], '{}'::text[])
FROM characters c
WHERE c.is_canon = TRUE
ON CONFLICT (character_id) DO NOTHING;

-- ── 5. Social Status (civilization rank, distinct from narrative fame) ──────
INSERT INTO social_status (character_id, status_tier, status_score)
SELECT
  c.id,
  CASE
    WHEN c.name IN ('Countess Vesper', 'Lord Adrian') THEN 'city_leader'
    WHEN c.is_featured                                 THEN 'regional_celebrity'
    ELSE 'skilled_professional'
  END,
  CASE
    WHEN c.name IN ('Countess Vesper', 'Lord Adrian') THEN 700
    WHEN c.is_featured                                 THEN 400
    ELSE 150
  END
FROM characters c
WHERE c.is_canon = TRUE
ON CONFLICT (character_id) DO NOTHING;

-- ── 6. Social Graph — light connective tissue between faction-mates ─────────
-- Caps at 2 links per character to avoid a fully-connected graph across
-- larger factions; deterministic ally/rival split via a hash of the pair so
-- re-running this migration produces the same graph rather than reshuffling
-- relationships on every deploy.
WITH faction_pairs AS (
  SELECT
    fm1.character_id AS char_a,
    fm2.character_id AS char_b,
    ROW_NUMBER() OVER (PARTITION BY fm1.character_id ORDER BY fm2.character_id) AS rn
  FROM faction_memberships fm1
  JOIN faction_memberships fm2
    ON fm1.faction_id = fm2.faction_id
   AND fm1.character_id < fm2.character_id
  JOIN characters c1 ON c1.id = fm1.character_id AND c1.is_canon = TRUE
  JOIN characters c2 ON c2.id = fm2.character_id AND c2.is_canon = TRUE
)
INSERT INTO companion_social_links (character_id, linked_character_id, link_type, strength, is_mutual)
SELECT
  char_a,
  char_b,
  CASE WHEN (('x' || substr(md5(char_a::text || char_b::text), 1, 8))::bit(32)::int % 3) = 0 THEN 'rival' ELSE 'ally' END,
  40 + (RANDOM() * 40)::INT,
  TRUE
FROM faction_pairs
WHERE rn <= 2
ON CONFLICT (character_id, linked_character_id) DO NOTHING;

-- ── 7. City leadership — narrative flavor for the two clearest noble/leader
-- archetypes. Only fills a NULL leader slot; never overwrites an existing one.
UPDATE city_governance
SET leader_character_id = (SELECT id FROM characters WHERE name = 'Lord Adrian' LIMIT 1)
WHERE location_id = (SELECT id FROM world_locations WHERE slug = 'obsidian-tower')
  AND leader_character_id IS NULL
  AND EXISTS (SELECT 1 FROM characters WHERE name = 'Lord Adrian');

UPDATE city_governance
SET leader_character_id = (SELECT id FROM characters WHERE name = 'Countess Vesper' LIMIT 1)
WHERE location_id = (SELECT id FROM world_locations WHERE slug = 'the-capital')
  AND leader_character_id IS NULL
  AND EXISTS (SELECT 1 FROM characters WHERE name = 'Countess Vesper');

-- ── Note for future characters ────────────────────────────────────────────
-- DONE — see src/lib/universe/provisioning.ts (provisionCharacterInUniverse),
-- wired into POST /api/characters and POST /api/characters/import, plus a
-- world_provisioning_sweep cron job (legacy-tick, every 6h) as a safety net.
-- 20260808_extend_world_provisioning_all_characters.sql backfilled every
-- other pre-existing active character (not just is_canon) the same way.

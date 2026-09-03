-- Extend world-identity backfill beyond is_canon, and seed market_value rows
--
-- 20260806_connect_characters_to_universe.sql only covered is_canon
-- characters. provisionCharacterInUniverse() (lib/universe/provisioning.ts)
-- now runs for every character going forward (creation + import routes),
-- and world_provisioning_sweep (legacy-tick cron) catches stragglers going
-- forward too — but any ACTIVE non-canon character that already existed
-- before this migration (e.g. approved user-created characters from before
-- this feature shipped) still has no world rows and would otherwise sit
-- idle until the next sweep tick. This is a one-time catch-up so the
-- rollout doesn't leave a visible gap.
--
-- Mirrors the app-layer logic in provisioning.ts: tier-weighted starting
-- wealth/occupation/faction-role/reputation, defaulting to the same modest
-- baseline the SQL backfill used for canon characters without an explicit
-- override.

-- ── 1. Character Attributes ──────────────────────────────────────────────────
INSERT INTO character_attributes (character_id, health, confidence, net_worth, wealth_tier, skills, political_view)
SELECT
  c.id,
  85,
  CASE
    WHEN c.tags::text ILIKE ANY (ARRAY['%bold%','%confident%','%commanding%']) THEN 75
    WHEN c.tags::text ILIKE ANY (ARRAY['%shy%','%guarded%','%withdrawn%'])     THEN 45
    ELSE 60
  END,
  CASE c.min_tier
    WHEN 'enterprise' THEN 300000
    WHEN 'elite'       THEN 140000
    WHEN 'premium'     THEN 60000
    WHEN 'basic'       THEN 40000
    WHEN 'spark'       THEN 12000
    ELSE 8000
  END,
  CASE c.min_tier
    WHEN 'enterprise' THEN 'rich'
    WHEN 'elite'       THEN 'wealthy'
    WHEN 'premium'     THEN 'comfortable'
    WHEN 'basic'       THEN 'comfortable'
    ELSE 'modest'
  END,
  '{}'::jsonb,
  'undeclared'
FROM characters c
WHERE c.active = TRUE
ON CONFLICT (character_id) DO NOTHING;

-- ── 2. Companion Occupations ──────────────────────────────────────────────────
INSERT INTO companion_occupations (character_id, occupation_id, employer, location_id, salary)
SELECT
  c.id,
  COALESCE(
    (
      SELECT o.id FROM occupations o
      WHERE c.occupation ILIKE '%' || o.title || '%'
         OR c.occupation ILIKE '%' || split_part(o.title, ' ', 1) || '%'
      ORDER BY o.prestige DESC
      LIMIT 1
    ),
    (SELECT id FROM occupations WHERE title = CASE
      WHEN c.min_tier IN ('elite','enterprise') THEN 'Researcher'
      WHEN c.min_tier IN ('basic','premium')     THEN 'Architect'
      ELSE 'Freelancer'
    END)
  ),
  COALESCE(NULLIF(trim(split_part(c.occupation, ',', 1)), ''), 'Independent'),
  COALESCE(
    (
      SELECT wl.id FROM world_locations wl
      WHERE
           (c.tags::text ILIKE ANY (ARRAY['%academic%','%scholar%']) OR c.occupation ILIKE ANY (ARRAY['%professor%','%research%','%librarian%'])) AND wl.slug = 'the-archive'
        OR (c.tags::text ILIKE ANY (ARRAY['%noble%','%aristocrat%','%royal%','%ancient%'])) AND wl.slug = 'obsidian-tower'
        OR (c.occupation ILIKE ANY (ARRAY['%engineer%','%tech%','%software%','%analyst%'])) AND wl.slug = 'cloudspire'
        OR (c.tags::text ILIKE ANY (ARRAY['%mysterious%','%witch%','%occult%','%enigma%','%ghost%'])) AND wl.slug = 'the-undercroft'
        OR (c.occupation ILIKE ANY (ARRAY['%chef%','%restaurant%','%trade%','%craft%'])) AND wl.slug = 'iron-reach'
      LIMIT 1
    ),
    (SELECT id FROM world_locations WHERE slug = CASE
      WHEN c.min_tier IN ('premium','elite','enterprise') THEN 'the-capital'
      WHEN c.min_tier IN ('spark','basic')                 THEN 'cloudspire'
      ELSE 'iron-reach'
    END)
  ),
  (CASE c.min_tier
    WHEN 'enterprise' THEN 25000 WHEN 'elite' THEN 14000 WHEN 'premium' THEN 8000
    WHEN 'basic' THEN 5500 WHEN 'spark' THEN 3500 ELSE 2500
  END) + (RANDOM() * 1000)::INT
FROM characters c
WHERE c.active = TRUE
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
        OR c.tags::text ILIKE ANY (ARRAY['%noble%','%aristocrat%','%royal%']) AND f.slug = 'old-families'
        OR c.occupation ILIKE ANY (ARRAY['%engineer%','%tech%','%scientist%','%software%','%analyst%']) AND f.slug = 'the-protocol'
        OR c.occupation ILIKE ANY (ARRAY['%chef%','%trade%','%craft%','%worker%']) AND f.slug = 'iron-compact'
      LIMIT 1
    ),
    (SELECT id FROM factions WHERE slug = 'council-of-seven')
  ),
  CASE
    WHEN c.min_tier IN ('elite','enterprise') THEN 'lieutenant'
    WHEN c.min_tier IN ('basic','premium')     THEN 'senior member'
    ELSE 'member'
  END,
  TRUE
FROM characters c
WHERE c.active = TRUE
ON CONFLICT (character_id, faction_id) DO NOTHING;

-- ── 4. Companion Reputation ───────────────────────────────────────────────────
INSERT INTO companion_reputation (character_id, reputation_type, fame_score, notoriety_score, known_for)
SELECT
  c.id,
  CASE
    WHEN c.tags::text ILIKE ANY (ARRAY['%villain%','%dark%','%outlaw%'])                 THEN 'villain'
    WHEN c.tags::text ILIKE ANY (ARRAY['%mysterious%','%ancient%','%ghost%','%enigma%'])  THEN 'enigma'
    WHEN c.tags::text ILIKE ANY (ARRAY['%hero%','%protector%','%guardian%'])              THEN 'hero'
    WHEN c.is_featured OR c.min_tier IN ('premium','elite','enterprise')                  THEN 'celebrity'
    ELSE 'neutral'
  END,
  LEAST(300,
    (CASE
      WHEN c.is_featured THEN 150
      ELSE (CASE c.min_tier
        WHEN 'enterprise' THEN 170 WHEN 'elite' THEN 130 WHEN 'premium' THEN 90
        WHEN 'basic' THEN 60 WHEN 'spark' THEN 35 ELSE 20
      END)
    END) + (RANDOM() * 40)::INT
  ),
  CASE WHEN c.tags::text ILIKE ANY (ARRAY['%outlaw%','%dark%','%villain%']) THEN 40 + (RANDOM() * 60)::INT ELSE (RANDOM() * 15)::INT END,
  COALESCE(c.tags[1:3], '{}'::text[])
FROM characters c
WHERE c.active = TRUE
ON CONFLICT (character_id) DO NOTHING;

-- ── 5. Market Value rows — seeded at zero, purely earned (no tier weighting;
-- see provisioning.ts's note on why this axis stays tier-agnostic) ──────────
INSERT INTO character_market_value (character_id, value_score, percentile, rarity_tier, previous_tier, value_history, signals)
SELECT c.id, 0, 0, 'common', NULL, '[]'::jsonb, '{}'::jsonb
FROM characters c
WHERE c.active = TRUE
ON CONFLICT (character_id) DO NOTHING;

-- ── 6. Social Status — left for the next status_tick / market_value_tick run
-- (legacy-tick, every 6h) rather than computed here in raw SQL, since
-- computeStatusScore()'s formula lives in application code (status-legend.ts)
-- and duplicating it in SQL would drift the moment either one changes.
-- Trigger an immediate run after deploying this migration by hitting
-- /api/workers/run once (see legacy-tick route), or wait for the next
-- scheduled tick — these characters simply read as 'unknown_citizen' /
-- score 0 until then, same as any brand-new character would.

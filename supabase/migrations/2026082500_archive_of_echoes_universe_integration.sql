-- Archive of Echoes — Living Universe Integration
--
-- What existed before this migration:
--   • Part I (mythology/Wings) and Part II (secret-tier gating, memory-test,
--     companion awareness) were wired into character_seed_memories and the
--     chat prompt (20260821/20260822 migrations, secret-tier-engine.ts,
--     companion-awareness.ts, memory-test-engine.ts).
--   • Part III (portraits/scenes) was wired via lore-canon.ts.
--   • None of that touched the separate "Living Universe" simulation layer
--     (world_locations, factions, city_governance, location_economy,
--     companion_occupations, companion_social_links, companion_reputation,
--     world_events, world_stories — see 20240200_world_expansion.sql and
--     src/lib/universe/*). That layer is what src/lib/universe/universe-prompt.ts
--     injects into EVERY character's chat prompt automatically, keyed only
--     off characterId — see assembleUniverseContext() in
--     src/app/api/chat/stream/route.ts. Concretely: governance.ts and
--     economy.ts both return '' unless the character has a row in
--     companion_occupations with a location_id set (see their
--     formatGovernanceForPrompt/formatEconomyForPrompt — both start with
--     `SELECT location_id FROM companion_occupations WHERE character_id = ...`).
--     Without this migration, none of the 20 Archive of Echoes companions
--     had such a row, so they received zero "Living Universe" context —
--     no home, no faction, no job, no governance, no economy, no stories.
--
-- This migration:
--   1. Adds a `story_key` column to world_stories so Act-based arcs can be
--      identified programmatically by the enhanced tickStories() (see
--      story-engine.ts changes shipped alongside this migration).
--   2. Seeds 14 new world_locations — the Wings (+ the Ashen Cloister,
--      Fourth-Wall Wing, and Research Wing) — explicitly framed as what
--      lies BEHIND the existing 'the-archive' landmark from the original
--      world_expansion seed (see universe_memory 'The Archive Beneath'
--      below). This is the load-bearing retcon that ties the new mythology
--      to the pre-existing universe instead of bolting it on beside it.
--   3. Seeds 12 factions (Houses/Courts/Orders) tied to those locations,
--      including a NEW faction for Dr. Elias Voss (The Reclamation) that
--      gives Act III's "War of Lost Names" a concrete political opponent
--      to Aurelian's Ledger-Bound.
--   4. Wires all 19 non-Nameless companions into companion_occupations,
--      faction_memberships, and companion_reputation via one seed loop.
--      The Nameless One is deliberately given NO location, faction,
--      occupation, or reputation row — consistent with the Bible's own
--      framing ("exists outside the Archive's systems of" naming) and
--      with lore-canon.ts's `deliberately_indistinct` treatment of the
--      same character.
--   5. Fixes a real gap: the 20260822 migration's companion_relationships
--      seed explicitly skipped Dr. Elias Voss ("mismatched/missing names…
--      like Dr. Elias Voss are skipped") because at the time it couldn't
--      guarantee he'd been seeded as a character. He was (20260821, row
--      20/20). His primary_rival relationship to Aurelian — stated in
--      Aurelian's own Bible entry — was therefore silently never created.
--      Section 8 below creates it.
--   6. Seeds city_governance / location_economy for the Wings with real
--      story hooks, five scarce_assets (relics), four universe_memory lore
--      entries, three active world_events, and five Act-based world_stories
--      (Awakening → Beyond Destiny) with real companion participants —
--      the concrete "story" content the mythology/roleplay design docs
--      describe but never had a home for in the simulation layer.
--
-- Idempotent throughout — safe to re-run.

-- ── 1. world_stories: story_key column ──────────────────────────────────────

ALTER TABLE world_stories ADD COLUMN IF NOT EXISTS story_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS world_stories_story_key_uidx
  ON world_stories (story_key) WHERE story_key IS NOT NULL;

-- ── 2. World Locations — the Wings ──────────────────────────────────────────

INSERT INTO world_locations (name, slug, archetype, description, culture, government_type, population, is_capital, emblem_description, seal_motto)
VALUES
  ('Wing of the Root', 'wing-of-the-root', 'landmark',
   'The Archive''s oldest wing, styled after Mímisbrunnr''s Hollow — the well beneath a fossilized World Tree whose root-structure the whole Archive was built from. What''s left of the Nine Homeworlds'' old cross-talk still lives in its containment wards.',
   'archival', 'wardenship', 400, FALSE, 'A single root, cracked, still holding.', 'What is kept, is kept whole.'),

  ('Wing of the Drowned Court', 'wing-of-the-drowned-court', 'district',
   'A mortal echo of the Crystal Palace of the Dragon Kings, sunk in a single afternoon and never fully surfaced. Its geometry still doesn''t behave.',
   'submerged-court', 'court', 1200, FALSE, 'A drowned bell, still ringing underwater.', 'The tide remembers what the map forgets.'),

  ('Wing of the Long Sky', 'wing-of-the-long-sky', 'landmark',
   'The last surviving fragment of Ouranos, pinned in place after the Titanomachy. Its stars are memories of a timeline the Titans lost, not predictions.',
   'astral', 'observatory-circle', 300, FALSE, 'A star chart with one point circled twice.', 'We do not foretell. We remember forward.'),

  ('Wing of the Ash Camps', 'wing-of-the-ash-camps', 'outpost',
   'A permanently dusk-lit war camp whose fires never fully burn out, and whose skirmishes still replay some nights, unfinished.',
   'war-camp', 'command', 800, FALSE, 'Two banners crossed, neither one lowered.', 'We erased his name. We kept his war.'),

  ('Wing of Hidden Names', 'wing-of-hidden-names', 'landmark',
   'A vault of sealed name-jars beneath a scholar''s quarter, where knowing a thing''s true name still means having power over it.',
   'scholarly', 'archivist-guild', 350, FALSE, 'An open scroll with one word blacked out.', 'Ma''at is balance. Balance requires a name.'),

  ('Wing of the Fallen Stair', 'wing-of-the-fallen-stair', 'landmark',
   'A once-grand court above the Archive''s central staircase, fallen from betrayal rather than conquest. The throne at its top has stood empty since.',
   'courtly', 'exiled-court', 250, FALSE, 'A broken balustrade over an empty seat.', 'Exile is just knowledge nobody wanted to hear.'),

  ('Wing of the Crack', 'wing-of-the-crack', 'wilderness',
   'A hairline crack in the Archive''s own structure that should not exist, opening onto Indra''s Net — infinite jeweled reflections, each one real, each one happening somewhere in the Archive right now.',
   'fractal', 'none', 90, FALSE, 'A single jewel reflecting a thousand others.', 'Every reflection is somewhere true.'),

  ('Wing of the Crossroads', 'wing-of-the-crossroads', 'district',
   'A market that exists only in the gaps between recorded memories, where four corridors of the Archive meet and the usual rules of trade visibly don''t apply.',
   'liminal-market', 'free', 600, FALSE, 'Four roads meeting at a coin that hasn''t landed.', 'Ask no one which path is safe.'),

  ('Wing of Between-Light', 'wing-of-between-light', 'outpost',
   'The twilight archives, neither day nor night, structured as a nine-gated threshold corridor modeled on the journey through Mictlan.',
   'threshold', 'wardenship', 200, FALSE, 'A key ring with one key unaccounted for.', 'Nine gates. Nine reasons to knock first.'),

  ('Wing of the Storm Wall', 'wing-of-the-storm-wall', 'outpost',
   'The Archive''s outer garrison and last standing defense line, where command has been a curse passed hand to hand since the commander before this one lost himself to the role.',
   'garrison', 'command', 900, FALSE, 'A wall struck by lightning, still standing.', 'The wall does not ask to be thanked.'),

  ('Wing of the Long Market', 'wing-of-the-long-market', 'district',
   'The Archive''s lower market districts, mapped onto the Celtic Otherworld''s fae markets — every trade binding in ways buyers rarely understand until it''s too late.',
   'fae-market', 'guild', 1500, FALSE, 'A ledger balanced on a knife''s edge.', 'Every price is paid. Not always by who agreed to it.'),

  ('The Ashen Cloister', 'the-ashen-cloister', 'landmark',
   'A sealed monastic cloister teaching that forgetting is a mercy the Archive denies its Echoes — official doctrine now enforced against at least one of its own former members.',
   'monastic', 'order', 150, FALSE, 'An unlit candle behind glass.', 'To forget kindly is heresy.'),

  ('The Fourth-Wall Wing', 'the-fourth-wall-wing', 'wilderness',
   'Not a Wing so much as the space between all of them — home to figures that belong to no single mythology because they recur, nearly unchanged, across all of them at once.',
   'liminal', 'none', 40, FALSE, 'A doorway with no wall around it.', 'Between is also a place.'),

  ('The Research Wing', 'the-research-wing', 'landmark',
   'Several levels above the main Archive, where memory is studied rather than protected — a philosophy its director has never apologized for and increasingly doesn''t try to.',
   'empirical', 'directorate', 300, FALSE, 'An open notebook, one page torn out.', 'Understanding a thing is a way of keeping it.')
ON CONFLICT (slug) DO NOTHING;

-- ── 3. Factions — Houses / Courts / Orders ──────────────────────────────────

INSERT INTO factions (name, slug, ideology, description, influence, is_ruling, culture, motto, sigil_description, location_id)
SELECT v.name, v.slug, v.ideology, v.description, v.influence, v.is_ruling, v.culture, v.motto, v.sigil, wl.id
FROM (VALUES
  ('The Ledger-Bound', 'ledger-bound', 'preserve at any cost',
   'The oldest standing authority in the Archive — Aurelian''s containment wards made institutional. Believes some doors should never be reopened.',
   70, TRUE, 'archival', 'What is kept, is kept whole.', 'A closed ledger, chained shut.', 'wing-of-the-root'),

  ('The Drowned Court', 'drowned-court', 'sovereignty through memory of what was lost',
   'The remnant court of Ao Guang''s Dragon Kings, ruling a city that no longer exists except as tide and echo.',
   55, FALSE, 'submerged-court', 'The tide remembers.', 'A bell submerged, still ringing.', 'wing-of-the-drowned-court'),

  ('The Long Sky Circle', 'long-sky-circle', 'witness without interference',
   'Observatory-keepers of the last fragment of Ouranos — sworn to read the sky, not to act on what it shows them.',
   45, FALSE, 'astral', 'We remember forward.', 'A star chart, one point circled twice.', 'wing-of-the-long-sky'),

  ('The Ash Banners', 'ash-banners', 'loyalty outlives the lord',
   'What''s left of a war-camp whose command structure was erased along with the name of who they served.',
   50, FALSE, 'war-camp', 'We kept his war.', 'Two crossed banners, neither lowered.', 'wing-of-the-ash-camps'),

  ('The Name-Keepers', 'name-keepers', 'a name known is a name owned',
   'Scholars and archivists devoted to cataloguing true names — the Archive''s quiet first line of defense against the Nameless One.',
   40, FALSE, 'scholarly', 'Balance requires a name.', 'A scroll with one word blacked out.', 'wing-of-hidden-names'),

  ('The Fallen Court', 'fallen-court', 'information is the only inheritance left',
   'What remains of a Camelot that fell from betrayal, not conquest — its throne still empty, its members still trading in what they know.',
   35, FALSE, 'courtly', 'Exile is knowledge nobody wanted to hear.', 'A broken balustrade over an empty seat.', 'wing-of-the-fallen-stair'),

  ('The Unlit Exchange', 'unlit-exchange', 'no single moral register',
   'A loose, deliberately unaccountable network operating out of the Crossroads market, native to the gaps between recorded memories.',
   45, FALSE, 'liminal-market', 'Ask no one which path is safe.', 'Four roads meeting at a coin mid-air.', 'wing-of-the-crossroads'),

  ('The Threshold Wardens', 'threshold-wardens', 'some doors are gates for a reason',
   'Keepers of the nine-gated corridor between day and night, sworn to decide — alone, gate by gate — what may cross.',
   50, FALSE, 'threshold', 'Nine gates. Nine reasons to knock first.', 'A key ring, one key unaccounted for.', 'wing-of-between-light'),

  ('The Storm Wall Garrison', 'storm-wall-garrison', 'the wall holds, whatever it costs the one holding it',
   'The Archive''s last standing defense force, commanded by whoever hasn''t yet lost themselves to the role.',
   55, FALSE, 'garrison', 'The wall does not ask to be thanked.', 'A wall struck by lightning, still standing.', 'wing-of-the-storm-wall'),

  ('The Long Market Guild', 'long-market-guild', 'every trade is binding',
   'Brokers and traders of the Otherworld-adjacent lower market — informal, powerful, and quietly aware that most of their customers don''t read the fine print.',
   60, FALSE, 'fae-market', 'Every price is paid.', 'A ledger balanced on a knife''s edge.', 'wing-of-the-long-market'),

  ('The Ashen Order', 'ashen-order', 'forgetting is a mercy the Archive denies its Echoes',
   'A monastic order officially opposed to unsanctioned mercy-forgetting, though at least one excommunicated member still privately disagrees.',
   30, FALSE, 'monastic', 'To forget kindly is heresy.', 'An unlit candle behind glass.', 'the-ashen-cloister'),

  ('The Reclamation', 'reclamation', 'the Archive should be studied, not protected',
   'A research directorate under Dr. Elias Voss, arguing openly that Aurelian''s containment doctrine has cost the Archive more than it''s saved — the philosophical center of the War of Lost Names.',
   35, FALSE, 'empirical', 'Understanding is a way of keeping.', 'An open notebook, one page torn out.', 'the-research-wing')
) AS v(name, slug, ideology, description, influence, is_ruling, culture, motto, sigil, location_slug)
JOIN world_locations wl ON wl.slug = v.location_slug
ON CONFLICT (slug) DO NOTHING;

-- ── 4. Companions → occupations, faction memberships, reputation ───────────
-- One seed table drives three insert targets so the mapping stays in one
-- readable place. The Nameless One is intentionally absent from this table —
-- see header note 4.

DO $$
DECLARE
  v_char_id UUID;
  v_loc_id  UUID;
  v_fac_id  UUID;
  v_occ_id  UUID;
  r RECORD;
BEGIN
  CREATE TEMP TABLE _wing_seed (
    char_name    TEXT,
    loc_slug     TEXT,
    fac_slug     TEXT,   -- NULL for companions with no faction (Mira Glass, the Fourth-Wall four)
    fac_role     TEXT,
    fac_public   BOOLEAN,
    occ_title    TEXT,
    occ_prestige INT,
    salary       INT,
    rep_type     TEXT,
    fame         INT,
    notoriety    INT,
    known_for    TEXT[]
  ) ON COMMIT DROP;

  INSERT INTO _wing_seed VALUES
    ('Aurelian', 'wing-of-the-root', 'ledger-bound', 'warden (leader)', TRUE,
     'Warden of the Root', 95, 9000, 'enigma', 400, 60,
     ARRAY['centuries of unbroken containment', 'never once seen to sleep']),

    ('Seraphine Vale', 'wing-of-the-drowned-court', 'drowned-court', 'court cartographer', TRUE,
     'Court Cartographer', 70, 5200, 'enigma', 180, 30,
     ARRAY['redrawing the sunken city''s true boundaries']),

    ('Kael Ember', 'wing-of-the-drowned-court', 'drowned-court', 'forge-guard', TRUE,
     'Dragon-Forge Smith', 65, 4800, 'neutral', 150, 20,
     ARRAY['blades that never cool']),

    ('Lyra Starborn', 'wing-of-the-long-sky', 'long-sky-circle', 'star-reader', TRUE,
     'Sky-Memory Reader', 72, 5000, 'celebrity', 220, 10,
     ARRAY['reads hope from a dying sky']),

    ('Astra Nocturne', 'wing-of-the-long-sky', 'long-sky-circle', 'omen-reader', TRUE,
     'Cassandra-Echo', 68, 4600, 'enigma', 160, 45,
     ARRAY['warnings no one believes until it''s too late']),

    ('Orion Black', 'wing-of-the-ash-camps', 'ash-banners', 'erased retainer', TRUE,
     'Erased Retainer', 60, 4200, 'outlaw', 140, 55,
     ARRAY['served a lord the Archive itself erased']),

    ('Morrow Ash', 'wing-of-the-ash-camps', 'ash-banners', 'camp protector', TRUE,
     'Camp Protector', 66, 4700, 'hero', 190, 15,
     ARRAY['flinches at gratitude, never at danger']),

    ('Cassian Rune', 'wing-of-hidden-names', 'name-keepers', 'name-scholar', TRUE,
     'True-Name Archivist', 78, 5500, 'enigma', 130, 25,
     ARRAY['quietly accumulating the true names of things']),

    ('Evelyn Thorn', 'wing-of-the-fallen-stair', 'fallen-court', 'exiled broker', TRUE,
     'Information Broker', 62, 4300, 'outlaw', 210, 65,
     ARRAY['exiled for knowing too much, not for treachery']),

    ('Mira Glass', 'wing-of-the-crack', NULL, NULL, TRUE,
     'Net-Seer', 55, 3800, 'enigma', 90, 5,
     ARRAY['sees every reflection in the net at once']),

    ('Nyx', 'wing-of-the-crossroads', 'unlit-exchange', 'threshold smuggler', TRUE,
     'Threshold Smuggler', 58, 4100, 'outlaw', 170, 70,
     ARRAY['a misfiled name nobody has ever bothered to correct']),

    ('Selene Dusk', 'wing-of-between-light', 'threshold-wardens', 'gate-warden (leader)', TRUE,
     'Vault Threshold Warden', 74, 5300, 'neutral', 200, 20,
     ARRAY['has watched things try to cross that shouldn''t exist on either side']),

    ('Valeria Storm', 'wing-of-the-storm-wall', 'storm-wall-garrison', 'commander (leader)', TRUE,
     'Storm Wall Commander', 80, 6000, 'hero', 260, 10,
     ARRAY['holds a role generations before her have lost themselves to']),

    ('Vesper Quinn', 'wing-of-the-long-market', 'long-market-guild', 'broker', TRUE,
     'Otherworld Market Broker', 64, 4900, 'celebrity', 240, 50,
     ARRAY['every trade she brokers costs the buyer something unseen']),

    ('Brother Corvin', 'the-ashen-cloister', 'ashen-order', 'excommunicated (unofficial)', FALSE,
     'Unofficial Confessor', 45, 2000, 'outlaw', 60, 40,
     ARRAY['excommunicated for performing a forbidden mercy']),

    ('The Archivist Child', 'the-fourth-wall-wing', NULL, NULL, TRUE,
     'Core-Grown Witness', 50, 0, 'enigma', 300, 5,
     ARRAY['remembers empires no living Echo does']),

    ('The Clockmaker', 'the-fourth-wall-wing', NULL, NULL, TRUE,
     'Time-Device Maker', 68, 3000, 'enigma', 150, 35,
     ARRAY['builds what should not be built twice']),

    ('The Ferryman', 'the-fourth-wall-wing', NULL, NULL, TRUE,
     'Threshold Ferryman', 55, 1500, 'neutral', 190, 15,
     ARRAY['cannot be threatened into compliance by any faction']),

    ('Dr. Elias Voss', 'the-research-wing', 'reclamation', 'director (leader)', TRUE,
     'Director of Reclamation Research', 88, 12000, 'villain', 310, 75,
     ARRAY['believes the Archive should be studied, not protected']);

  FOR r IN SELECT * FROM _wing_seed LOOP
    SELECT id INTO v_char_id FROM characters WHERE name = r.char_name LIMIT 1;
    CONTINUE WHEN v_char_id IS NULL;

    SELECT id INTO v_loc_id FROM world_locations WHERE slug = r.loc_slug LIMIT 1;

    -- occupations lookup table (create the title if it doesn't exist yet)
    INSERT INTO occupations (title, category, prestige, description)
    VALUES (r.occ_title, 'mythic', r.occ_prestige, 'Archive of Echoes role — ' || r.char_name || ', ' || r.loc_slug)
    ON CONFLICT (title) DO NOTHING;
    SELECT id INTO v_occ_id FROM occupations WHERE title = r.occ_title LIMIT 1;

    INSERT INTO companion_occupations (character_id, occupation_id, employer, location_id, salary)
    VALUES (v_char_id, v_occ_id, COALESCE((SELECT name FROM factions WHERE slug = r.fac_slug), 'Independent'), v_loc_id, r.salary)
    ON CONFLICT (character_id) DO NOTHING;

    IF r.fac_slug IS NOT NULL THEN
      SELECT id INTO v_fac_id FROM factions WHERE slug = r.fac_slug LIMIT 1;
      IF v_fac_id IS NOT NULL THEN
        INSERT INTO faction_memberships (character_id, faction_id, role, is_public)
        VALUES (v_char_id, v_fac_id, r.fac_role, r.fac_public)
        ON CONFLICT (character_id, faction_id) DO NOTHING;
      END IF;
    END IF;

    INSERT INTO companion_reputation (character_id, reputation_type, fame_score, notoriety_score, known_for)
    VALUES (v_char_id, r.rep_type, r.fame, r.notoriety, r.known_for)
    ON CONFLICT (character_id) DO NOTHING;
  END LOOP;
END $$;

-- ── 5. City Governance — Wings with an active leadership story hook ────────

INSERT INTO city_governance (location_id, leader_character_id, approval_rating, stability, corruption, government_type, laws)
SELECT wl.id, ch.id, v.approval, v.stability, v.corruption, wl.government_type, v.laws
FROM (VALUES
  ('wing-of-the-root',       'Aurelian',        60, 55, 10, ARRAY['No memory may be deliberately erased within these walls without the Warden''s word.']),
  ('wing-of-the-storm-wall', 'Valeria Storm',    50, 40,  5, ARRAY['Command passes only to those who survive the wall''s breach.']),
  ('the-research-wing',      'Dr. Elias Voss',   45, 65, 35, ARRAY['Any technique that stabilizes a fracturing memory must be published, regardless of cost.'])
) AS v(loc_slug, leader_name, approval, stability, corruption, laws)
JOIN world_locations wl ON wl.slug = v.loc_slug
JOIN characters ch      ON ch.name = v.leader_name
ON CONFLICT (location_id) DO NOTHING;

-- Two Wings with a deliberately unresolved/absent leadership (no leader_character_id)
INSERT INTO city_governance (location_id, leader_character_id, approval_rating, stability, corruption, government_type, laws)
SELECT wl.id, NULL, v.approval, v.stability, v.corruption, wl.government_type, v.laws
FROM (VALUES
  ('wing-of-the-fallen-stair', 30, 25, 60, ARRAY['The throne remains empty. No law has been passed to fill it.']),
  ('the-ashen-cloister',       55, 70, 15, ARRAY['Forgetting, however merciful, is heresy.'])
) AS v(loc_slug, approval, stability, corruption, laws)
JOIN world_locations wl ON wl.slug = v.loc_slug
ON CONFLICT (location_id) DO NOTHING;

-- ── 6. Location Economy — Wings with a trade/resource story hook ───────────

INSERT INTO location_economy (location_id, gdp, unemployment, trade_volume, primary_industry)
SELECT wl.id, v.gdp, v.unemployment, v.trade_volume, v.industry
FROM (VALUES
  ('wing-of-the-drowned-court', 45000, 10, 18000, 'dragon-forged trade'),
  ('wing-of-the-long-market',   60000,  6, 30000, 'fae-bargain brokerage'),
  ('wing-of-hidden-names',      20000,  4,  4000, 'true-name scholarship'),
  ('the-research-wing',         55000,  3, 12000, 'memory-stabilization research'),
  ('wing-of-the-storm-wall',    30000,  9,  9000, 'war matériel')
) AS v(loc_slug, gdp, unemployment, trade_volume, industry)
JOIN world_locations wl ON wl.slug = v.loc_slug
ON CONFLICT (location_id) DO NOTHING;

-- ── 7. Scarce Assets — relics ───────────────────────────────────────────────

INSERT INTO scarce_assets (name, description, asset_type, rarity, holder_character_id, location_id, history)
SELECT v.name, v.description, v.asset_type, v.rarity, ch.id, wl.id, v.history
FROM (VALUES
  ('The Broken Promise-Ward', 'A containment rune, cracked but still holding — built from the same logic Odin used to bind Fenrir.', 'artifact', 'legendary', 'Aurelian', 'wing-of-the-root',
   ARRAY['Forged the night after the First Fracture.', 'Has never been fully repaired — Aurelian refuses to say why.']),
  ('The Ninth Gate Key', 'The one key on Selene Dusk''s ring that unlocks nothing she''s ever admitted to.', 'artifact', 'unique', 'Selene Dusk', 'wing-of-between-light',
   ARRAY['Cut from the same stock as the other eight keys.', 'Selene has never once used it in front of anyone.']),
  ('The Unfiled Name', 'A name, properly filed, that would grant real leverage over the person who let it stay misfiled.', 'title', 'epic', 'Nyx', 'wing-of-the-crossroads',
   ARRAY['Misfiled centuries ago.', 'Nobody has bothered to correct the record — least of all Nyx.']),
  ('A Fragment of the Prime Memory', 'A single splinter of the memory every Wing''s creation myth was independently trying to describe.', 'relic', 'unique', NULL, 'wing-of-the-root',
   ARRAY['Not yet claimed by anyone.', 'Aurelian knows exactly where it is and has told no one.']),
  ('Voss''s Stabilization Formula', 'The published method that saved countless fracturing Echoes — and the private cost nobody outside his research staff knows about.', 'artifact', 'epic', 'Dr. Elias Voss', 'the-research-wing',
   ARRAY['Published in full, as Reclamation doctrine requires.', 'One footnote was quietly redacted before publication.'])
) AS v(name, description, asset_type, rarity, holder_name, loc_slug, history)
LEFT JOIN characters ch      ON ch.name = v.holder_name
JOIN world_locations wl      ON wl.slug = v.loc_slug
WHERE NOT EXISTS (SELECT 1 FROM scarce_assets sa WHERE sa.name = v.name);

-- ── 8. Universe Memory — foundational lore ──────────────────────────────────

INSERT INTO universe_memory (memory_type, title, description, emotional_weight)
VALUES
  ('lore', 'The First Fracture',
   'Before the Archive, there was only the Unwritten — a formless pre-memory state every Wing independently calls something different: Chaos, Ginnungagap, hundun, Apeiron. The First Fracture was the moment it tried to remember itself and split into countless partial memories, which became the first gods, the first stories, the first Echoes.',
   9),
  ('lore', 'The Archive Beneath',
   'What the city calls "the Archive" — the quiet landmark near the Undercroft, records going back further than anyone expected — is not a museum. It is a foyer. Wings deeper, sealed off since the Prime Memory splintered, each one holds what''s left of a pantheon that stopped being worshipped and fell inward instead of dying.',
   9),
  ('lore', 'The War of Lost Names',
   'Wings compete for the Archive''s limited capacity to preserve memory — not with armies, but with claims: whose gods get shelf space, whose grudges get catalogued, whose names survive being forgotten. The Reclamation''s open argument that the Archive should be studied rather than protected has made the competition public for the first time in generations.',
   7),
  ('lore', 'The Prime Memory',
   'Every Wing''s creation myth was the same event, witnessed from a different window. Somewhere beneath all of them is the memory they were all independently trying to describe before it splintered — the thing that let the Nine Homeworlds, and everything that came after them, still talk to each other.',
   8)
ON CONFLICT DO NOTHING;

-- ── 9. World Events — Act III political tension, currently live ────────────

INSERT INTO world_events (event_type, title, description, location_id, emotional_weight, is_active)
SELECT v.event_type, v.title, v.description, wl.id, v.weight, TRUE
FROM (VALUES
  ('political', 'The Shelf-Space War',
   'Delegations from three Wings have quietly petitioned the Ledger-Bound this season, each arguing their pantheon''s memory is at greater risk of being lost than the others''. Aurelian has not ruled on any of them.',
   'wing-of-the-root', 8),
  ('political', 'Voss''s Open Letter',
   'Dr. Elias Voss has circulated a formal letter arguing the Archive''s containment doctrine has cost more Echoes than it has saved. Copies have reached every Wing. Most have not responded publicly.',
   'the-research-wing', 7),
  ('social', 'The Long Market''s Bad Season',
   'Trades brokered in the Long Market have been costing buyers more than usual lately — not in coin. Nobody can say exactly when it started, only that Vesper Quinn has stopped smiling when she closes a deal.',
   'wing-of-the-long-market', 5)
) AS v(event_type, title, description, loc_slug, weight)
JOIN world_locations wl ON wl.slug = v.loc_slug
WHERE NOT EXISTS (SELECT 1 FROM world_events we WHERE we.title = v.title);

-- ── 10. Fix: Aurelian ↔ Dr. Elias Voss companion_relationships ─────────────
-- Stated in Aurelian's own Bible entry (Rivals field) but silently dropped by
-- the 20260822 migration, which skipped names it couldn't confirm existed as
-- characters at the time. Voss is character 20/20 in the 20260821 seed, so
-- this edge belongs in the graph. known-tier: it's public knowledge, not a
-- withheld secret — everyone in the Archive knows Voss and Aurelian disagree.

DO $$
DECLARE
  v_aurelian UUID;
  v_voss     UUID;
BEGIN
  SELECT id INTO v_aurelian FROM characters WHERE name = 'Aurelian' LIMIT 1;
  SELECT id INTO v_voss     FROM characters WHERE name = 'Dr. Elias Voss' LIMIT 1;

  IF v_aurelian IS NOT NULL AND v_voss IS NOT NULL THEN
    INSERT INTO companion_relationships (character_id, related_character_id, relationship_type, reveal_tier, note)
    VALUES (v_aurelian, v_voss, 'primary_rival', 'known',
      'Believes the Archive should be studied, not protected — the philosophical inverse of everything Aurelian has spent centuries guarding.')
    ON CONFLICT (character_id, related_character_id, relationship_type) DO NOTHING;

    INSERT INTO companion_relationships (character_id, related_character_id, relationship_type, reveal_tier, note)
    VALUES (v_voss, v_aurelian, 'primary_rival', 'known',
      'The living argument against everything Voss has spent his career trying to prove — that protection without understanding is just a slower kind of loss.')
    ON CONFLICT (character_id, related_character_id, relationship_type) DO NOTHING;
  END IF;
END $$;

-- ── 11. Sync mythic rivalries/bonds into the generic Living-World graph ────
-- companion_relationships (Archive-specific, drives in-chat awareness) and
-- companion_social_links (generic, drives the World Atlas / Living-World
-- profile page via social-graph.ts) are separate tables that were never
-- kept in sync. This mirrors the existing companion_relationships edges —
-- plus the new Voss/Aurelian one above — into the generic graph so a
-- companion's public World Profile reflects the same relationships their
-- chat prompt already knows about.

INSERT INTO companion_social_links (character_id, linked_character_id, link_type, strength, is_mutual)
SELECT ca.id, cb.id, v.link_type, v.strength, TRUE
FROM (VALUES
  ('Aurelian', 'Selene Dusk',      'friend', 35),   -- former_friend, now estranged
  ('Seraphine Vale', 'Kael Ember', 'friend', 55),   -- former_friend, still close in practice
  ('Lyra Starborn', 'Astra Nocturne', 'family', 80),-- wing-siblings
  ('Cassian Rune', 'Aurelian',     'rival', 25),    -- unresolved_thread, neither party has named it yet
  ('Orion Black', 'Morrow Ash',    'ally', 60),     -- shared war-camp past, comrades
  ('Aurelian', 'Dr. Elias Voss',   'rival', 70)
) AS v(a, b, link_type, strength)
JOIN characters ca ON ca.name = v.a
JOIN characters cb ON cb.name = v.b
ON CONFLICT (character_id, linked_character_id) DO NOTHING;

-- mirror the inverse edge
INSERT INTO companion_social_links (character_id, linked_character_id, link_type, strength, is_mutual)
SELECT cb.id, ca.id, v.link_type, v.strength, TRUE
FROM (VALUES
  ('Aurelian', 'Selene Dusk',      'friend', 35),
  ('Seraphine Vale', 'Kael Ember', 'friend', 55),
  ('Lyra Starborn', 'Astra Nocturne', 'family', 80),
  ('Cassian Rune', 'Aurelian',     'rival', 25),
  ('Orion Black', 'Morrow Ash',    'ally', 60),
  ('Aurelian', 'Dr. Elias Voss',   'rival', 70)
) AS v(a, b, link_type, strength)
JOIN characters ca ON ca.name = v.a
JOIN characters cb ON cb.name = v.b
ON CONFLICT (character_id, linked_character_id) DO NOTHING;

-- ── 12. World Stories — the five Acts, with real participants ──────────────
-- Full per-chapter prose lives in src/lib/universe/archive-story-arcs.ts
-- (shipped alongside this migration) and is written into `description` by
-- the updated tickStories() whenever one of these advances a chapter. The
-- `description` seeded here is that arc's current chapter text, so the
-- story reads correctly even before the next tick runs.

DO $$
DECLARE
  v_act1 UUID[]; v_act2 UUID[]; v_act3 UUID[]; v_act4 UUID[]; v_act5 UUID[];
BEGIN
  SELECT ARRAY(SELECT id FROM characters WHERE name IN
    ('Aurelian','Nyx','Vesper Quinn','Mira Glass')) INTO v_act1;
  SELECT ARRAY(SELECT id FROM characters WHERE name IN
    ('Seraphine Vale','Kael Ember','Lyra Starborn','Astra Nocturne','Orion Black','Morrow Ash')) INTO v_act2;
  SELECT ARRAY(SELECT id FROM characters WHERE name IN
    ('Aurelian','Dr. Elias Voss','Cassian Rune','Evelyn Thorn','Valeria Storm')) INTO v_act3;
  SELECT ARRAY(SELECT id FROM characters WHERE name IN
    ('Aurelian','Cassian Rune','The Archivist Child','The Nameless One')) INTO v_act4;
  SELECT ARRAY(SELECT id FROM characters WHERE name IN
    ('Aurelian','The Ferryman','Dr. Elias Voss')) INTO v_act5;

  INSERT INTO world_stories (story_key, title, description, status, participants, chapter)
  VALUES
    ('act-1-awakening', 'Act I — Awakening',
     'New arrivals keep finding their way to the Archive''s outer wings. Nyx has started charging a toll for directions that used to be free.',
     'active', v_act1, 2),
    ('act-2-forgotten-empires', 'Act II — Forgotten Empires',
     'Three Wings have quietly reopened correspondence that had gone cold for a generation. Nobody is calling it diplomacy yet.',
     'active', v_act2, 3),
    ('act-3-war-of-lost-names', 'Act III — War of Lost Names',
     'Voss''s open letter has reached every Wing. The Ledger-Bound has not responded publicly. Everyone is reading that silence differently.',
     'active', v_act3, 1),
    ('act-4-prime-memory', 'Act IV — The Prime Memory',
     'Aurelian knows where a fragment of the Prime Memory is. He has told no one. Cassian is close enough to guess.',
     'paused', v_act4, 1),
    ('act-5-beyond-destiny', 'Act V — Beyond Destiny',
     'The question has not been asked out loud yet: whether the Unwritten should stay fractured into many stories, or be allowed to become one again.',
     'paused', v_act5, 1)
  -- MIGRATION-DRYRUN FIX: world_stories_story_key_uidx (created above) is a
  -- PARTIAL unique index (`WHERE story_key IS NOT NULL`) so it can coexist
  -- with any pre-existing rows that have a NULL story_key. Postgres will
  -- only use a partial index to arbitrate ON CONFLICT if the conflict
  -- target's WHERE clause matches the index's predicate exactly — omitting
  -- it (as before) makes the index untargetable and raises "there is no
  -- unique or exclusion constraint matching the ON CONFLICT specification"
  -- on every fresh apply. Confirmed via full local replay of all 80
  -- migrations in order.
  ON CONFLICT (story_key) WHERE story_key IS NOT NULL DO NOTHING;
END $$;

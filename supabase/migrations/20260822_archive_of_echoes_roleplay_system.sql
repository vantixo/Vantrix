-- Archive of Echoes — Roleplay & Dialogue System (Part II) + Mythology layer (Part I)
-- Wires into: character_seed_memories (already read at chat-init by assembleFullPrompt),
-- character_relationships (already tracks stage), characters table.
--
-- Adds three pieces of infrastructure described in the design doc's
-- "Technical Notes for Implementation":
--   1. secrets_unlocked tracking, keyed by tier, per (user, character)
--   2. a `testable` flag on seed memories + a table tracking whether/when
--      the character has already tested the player's recall of that fact
--   3. companion_relationships — a queryable graph generated from the
--      existing Rivals/Enemy/Former Friend fields already in the seed
--      memories, plus the new mythology-driven tensions (Lyra/Astra,
--      Seraphine/Kael, Cassian/Voss) from the expansion doc.
--
-- Nothing here changes any existing secret, relationship stage, questline,
-- or ending — it activates data that already exists.

-- ── 1. Secret-tier unlocks ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS character_secret_unlocks (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  character_id   UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  tier           TEXT NOT NULL CHECK (tier IN ('known', 'hidden', 'dark', 'catastrophic')),
  trust_reason   TEXT, -- behavioral justification, e.g. "kept the promise about the anniversary date"
  unlocked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, character_id, tier)
);

CREATE INDEX IF NOT EXISTS idx_secret_unlocks_user_char
  ON character_secret_unlocks (user_id, character_id);

ALTER TABLE character_secret_unlocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "secret_unlocks_owner_select" ON character_secret_unlocks;
CREATE POLICY "secret_unlocks_owner_select" ON character_secret_unlocks
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "secret_unlocks_service_write" ON character_secret_unlocks;
CREATE POLICY "secret_unlocks_service_write" ON character_secret_unlocks
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- ── 2. Memory-test mechanic ─────────────────────────────────────────────────
-- Mark specific seed memories as "testable" — the character may later check
-- whether the player remembers them. Not every fact should be testable;
-- creators/seed data opt individual rows in.
ALTER TABLE character_seed_memories
  ADD COLUMN IF NOT EXISTS is_testable BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS test_hint   TEXT; -- short recall cue, e.g. "the promise he once broke"

CREATE TABLE IF NOT EXISTS character_memory_tests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  character_id      UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  seed_memory_id    UUID NOT NULL REFERENCES character_seed_memories(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'passed', 'failed')),
  scheduled_at      TIMESTAMPTZ NOT NULL DEFAULT now(), -- earliest turn this may be tested
  tested_at         TIMESTAMPTZ,
  UNIQUE (user_id, character_id, seed_memory_id)
);

CREATE INDEX IF NOT EXISTS idx_memory_tests_user_char
  ON character_memory_tests (user_id, character_id, status);

ALTER TABLE character_memory_tests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "memory_tests_owner_select" ON character_memory_tests;
CREATE POLICY "memory_tests_owner_select" ON character_memory_tests
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "memory_tests_service_write" ON character_memory_tests;
CREATE POLICY "memory_tests_service_write" ON character_memory_tests
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- ── 3. Cross-companion awareness graph ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS companion_relationships (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id        UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  related_character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  relationship_type   TEXT NOT NULL CHECK (relationship_type IN
    ('primary_rival', 'hidden_rival', 'enemy', 'former_friend', 'wing_sibling', 'unresolved_thread')),
  -- Mirrors the secret-tier gate: how deep the relationship stage must be
  -- before the character will bring this up unprompted.
  reveal_tier         TEXT NOT NULL DEFAULT 'hidden' CHECK (reveal_tier IN ('known', 'hidden', 'dark', 'catastrophic')),
  note                TEXT, -- short in-character framing, injected verbatim as context
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (character_id, related_character_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS idx_companion_relationships_char
  ON companion_relationships (character_id);

-- Populate from the Rivals/Enemy/Former Friend fields already authored in
-- the 20260821 seed (character_seed_memories.category = 'rivals'), plus the
-- new mythology-driven tensions from the expansion doc. Wrapped in a helper
-- so mismatched/missing names (e.g. NPCs not seeded as characters, like
-- Dr. Elias Voss) are skipped rather than failing the whole migration.
DO $$
DECLARE
  rel RECORD;
BEGIN
  CREATE TEMP TABLE _rel_seed (
    a TEXT, b TEXT, kind TEXT, tier TEXT, note TEXT
  ) ON COMMIT DROP;

  INSERT INTO _rel_seed (a, b, kind, tier, note) VALUES
    ('Aurelian', 'Selene Dusk', 'former_friend', 'dark', 'Once his closest ally, now estranged over a choice he made — under the mythology layer, a disagreement over an Echo she refused to let cross her gate.'),
    ('Seraphine Vale', 'Kael Ember', 'former_friend', 'hidden', 'Left behind in Vale as it sank — the last two people who remember the drowned court was a choice, not a disaster.'),
    ('Lyra Starborn', 'Astra Nocturne', 'wing_sibling', 'known', 'Wing-siblings under a shared fractured sky-memory — Lyra reads the sky''s hope, Astra its grief.'),
    ('Cassian Rune', 'Aurelian', 'unresolved_thread', 'hidden', 'Cassian is quietly doing exactly what Aurelian''s rival Dr. Elias Voss wants — alone, and without knowing it.'),
    ('Orion Black', 'Morrow Ash', 'unresolved_thread', 'known', 'Both from the same war-camps beyond the eastern wall — a shared, unspoken history neither has fully named.')
  ;

  FOR rel IN SELECT * FROM _rel_seed LOOP
    INSERT INTO companion_relationships (character_id, related_character_id, relationship_type, reveal_tier, note)
    SELECT ca.id, cb.id, rel.kind, rel.tier, rel.note
    FROM characters ca, characters cb
    WHERE ca.name = rel.a AND cb.name = rel.b
    ON CONFLICT (character_id, related_character_id, relationship_type) DO NOTHING;

    -- mirror the inverse edge so lookups from either side work
    INSERT INTO companion_relationships (character_id, related_character_id, relationship_type, reveal_tier, note)
    SELECT cb.id, ca.id, rel.kind, rel.tier, rel.note
    FROM characters ca, characters cb
    WHERE ca.name = rel.a AND cb.name = rel.b
    ON CONFLICT (character_id, related_character_id, relationship_type) DO NOTHING;
  END LOOP;
END $$;

-- ── 4. Mythology layer (Part I) — additive seed memories ───────────────────
-- One 'mythology' category row per companion, high enough importance to
-- survive getCharacterSeedMemories()'s default limit of 8. Content trimmed
-- to stay under formatSeedMemoriesForPrompt's 200-char display window while
-- keeping the load-bearing reframe intact; full text lives in this migration
-- and the source doc for Creator Studio editing later.
DO $$
DECLARE
  v_owner_id UUID;
  v_char_id  UUID;
BEGIN
  SELECT id INTO v_owner_id FROM profiles WHERE role = 'admin' OR is_admin = TRUE ORDER BY created_at ASC LIMIT 1;
  IF v_owner_id IS NULL THEN
    RAISE NOTICE 'No admin profile found — skipping mythology seed. Run after an admin profile exists.';
    RETURN;
  END IF;

  -- helper pattern repeated per companion: look up id, insert if character exists and row absent
  SELECT id INTO v_char_id FROM characters WHERE name = 'Aurelian' LIMIT 1;
  IF v_char_id IS NOT NULL THEN
    INSERT INTO character_seed_memories (character_id, creator_id, category, headline, content, importance, is_testable, test_hint)
    SELECT v_char_id, v_owner_id, 'mythology', 'Mythological Lineage — Wing of the Root (Norse)',
      'His wing is Mímisbrunnr''s Hollow — the Archive''s core is a fossilized World Tree. The Prime Memory he failed to save was the tree''s last living root, the thing that let the Nine Homeworlds still speak to each other. His containment wards use the same runic logic Odin used to bind Fenrir: promises made physical.', 75, TRUE, 'the promise he once broke'
    WHERE NOT EXISTS (SELECT 1 FROM character_seed_memories WHERE character_id = v_char_id AND headline LIKE 'Mythological Lineage%');
  END IF;

  SELECT id INTO v_char_id FROM characters WHERE name = 'Seraphine Vale' LIMIT 1;
  IF v_char_id IS NOT NULL THEN
    INSERT INTO character_seed_memories (character_id, creator_id, category, headline, content, importance, is_testable, test_hint)
    SELECT v_char_id, v_owner_id, 'mythology', 'Mythological Lineage — Wing of the Drowned Court (Chinese)',
      'Vale is a mortal echo of the Crystal Palace of the Dragon Kings. Her mother wasn''t just mapping tunnels — she was redrawing the boundary lines Ao Guang once used to separate the mortal and drowned worlds. Vale''s geometry misbehaves because those lines are blurring, and only dragon-blood or dragon-taught hands can re-stabilize them.', 75, TRUE, 'why she left Vale as it sank'
    WHERE NOT EXISTS (SELECT 1 FROM character_seed_memories WHERE character_id = v_char_id AND headline LIKE 'Mythological Lineage%');
  END IF;

  SELECT id INTO v_char_id FROM characters WHERE name = 'Kael Ember' LIMIT 1;
  IF v_char_id IS NOT NULL THEN
    INSERT INTO character_seed_memories (character_id, creator_id, category, headline, content, importance, is_testable, test_hint)
    SELECT v_char_id, v_owner_id, 'mythology', 'Mythological Lineage — Wing of the Drowned Court (Chinese)',
      'His "impossible materials" are forged in dragon-fire quenched in a captured breath of the last Dragon King — which is why nothing he makes ever truly goes cold. He and Seraphine are the last two who remember the drowned court''s fall was a choice, not a disaster — a detail neither has told anyone.', 70, FALSE, NULL
    WHERE NOT EXISTS (SELECT 1 FROM character_seed_memories WHERE character_id = v_char_id AND headline LIKE 'Mythological Lineage%');
  END IF;

  SELECT id INTO v_char_id FROM characters WHERE name = 'Lyra Starborn' LIMIT 1;
  IF v_char_id IS NOT NULL THEN
    INSERT INTO character_seed_memories (character_id, creator_id, category, headline, content, importance, is_testable, test_hint)
    SELECT v_char_id, v_owner_id, 'mythology', 'Mythological Lineage — Wing of the Long Sky (Greek)',
      'The observatory levels are the last surviving fragment of Ouranos, pinned in place after the Titanomachy. Her prophecies are technically memories of a timeline the Titans lost — she is not predicting, she is remembering forward. Wing-sibling to Astra Nocturne: she carries the sky''s hope where Astra carries its grief.', 70, FALSE, NULL
    WHERE NOT EXISTS (SELECT 1 FROM character_seed_memories WHERE character_id = v_char_id AND headline LIKE 'Mythological Lineage%');
  END IF;

  SELECT id INTO v_char_id FROM characters WHERE name = 'Astra Nocturne' LIMIT 1;
  IF v_char_id IS NOT NULL THEN
    INSERT INTO character_seed_memories (character_id, creator_id, category, headline, content, importance, is_testable, test_hint)
    SELECT v_char_id, v_owner_id, 'mythology', 'Mythological Lineage — Wing of the Long Sky (Greek)',
      'A literal, not archetypal, echo of Cassandra — cursed to see true and unbelieved, the latest link in an unbroken chain of people carrying that curse since before Troy. Wing-sibling to Lyra Starborn: same fractured sky-memory, opposite half.', 70, FALSE, NULL
    WHERE NOT EXISTS (SELECT 1 FROM character_seed_memories WHERE character_id = v_char_id AND headline LIKE 'Mythological Lineage%');
  END IF;

  SELECT id INTO v_char_id FROM characters WHERE name = 'Orion Black' LIMIT 1;
  IF v_char_id IS NOT NULL THEN
    INSERT INTO character_seed_memories (character_id, creator_id, category, headline, content, importance, is_testable, test_hint)
    SELECT v_char_id, v_owner_id, 'mythology', 'Mythological Lineage — Wing of the Ash Camps (Japanese)',
      'A ronin-echo: his lord''s name was erased from the Archive''s record, leaving him a debt of loyalty to someone who, by any record, never existed. He is unaffiliated not by choice but because the Archive itself erased who he was supposed to serve.', 70, TRUE, 'the lord whose name was erased'
    WHERE NOT EXISTS (SELECT 1 FROM character_seed_memories WHERE character_id = v_char_id AND headline LIKE 'Mythological Lineage%');
  END IF;

  SELECT id INTO v_char_id FROM characters WHERE name = 'Morrow Ash' LIMIT 1;
  IF v_char_id IS NOT NULL THEN
    INSERT INTO character_seed_memories (character_id, creator_id, category, headline, content, importance, is_testable, test_hint)
    SELECT v_char_id, v_owner_id, 'mythology', 'Mythological Lineage — Wing of the Ash Camps (Japanese)',
      'Carries an onryō thread he doesn''t know about: the person he "forgave" died holding a grudge in the war-camps, and he has been unknowingly protecting people partly to keep that restless spirit from finding a new grievance to attach to.', 70, FALSE, NULL
    WHERE NOT EXISTS (SELECT 1 FROM character_seed_memories WHERE character_id = v_char_id AND headline LIKE 'Mythological Lineage%');
  END IF;

  SELECT id INTO v_char_id FROM characters WHERE name = 'Cassian Rune' LIMIT 1;
  IF v_char_id IS NOT NULL THEN
    INSERT INTO character_seed_memories (character_id, creator_id, category, headline, content, importance, is_testable, test_hint)
    SELECT v_char_id, v_owner_id, 'mythology', 'Mythological Lineage — Wing of Hidden Names (Egyptian)',
      'Reframed around Thoth, scribe of Ma''at — in this cosmology, knowing a thing''s true name gives power over it, so his dead-language collecting is really the quiet accumulation of true names, either the Archive''s best defense against the Nameless One or its most dangerous hobby.', 70, FALSE, NULL
    WHERE NOT EXISTS (SELECT 1 FROM character_seed_memories WHERE character_id = v_char_id AND headline LIKE 'Mythological Lineage%');
  END IF;

  SELECT id INTO v_char_id FROM characters WHERE name = 'Evelyn Thorn' LIMIT 1;
  IF v_char_id IS NOT NULL THEN
    INSERT INTO character_seed_memories (character_id, creator_id, category, headline, content, importance, is_testable, test_hint)
    SELECT v_char_id, v_owner_id, 'mythology', 'Mythological Lineage — Wing of the Fallen Stair (Arthurian)',
      'A Guinevere/Morgan-composite: exiled not for treachery but for knowing about it and being blamed for the knowing. Trading information now is a direct inversion of the life where having information got her punished.', 65, FALSE, NULL
    WHERE NOT EXISTS (SELECT 1 FROM character_seed_memories WHERE character_id = v_char_id AND headline LIKE 'Mythological Lineage%');
  END IF;

  SELECT id INTO v_char_id FROM characters WHERE name = 'Mira Glass' LIMIT 1;
  IF v_char_id IS NOT NULL THEN
    INSERT INTO character_seed_memories (character_id, creator_id, category, headline, content, importance, is_testable, test_hint)
    SELECT v_char_id, v_owner_id, 'mythology', 'Mythological Lineage — Wing of the Crack (Hindu)',
      'Reframed through Indra''s Net — she doesn''t see the future, she sees other reflections in the net, each one really happening somewhere in the Archive right now. Her fragility is structural overload from standing where too many reflections converge, not weakness.', 65, FALSE, NULL
    WHERE NOT EXISTS (SELECT 1 FROM character_seed_memories WHERE character_id = v_char_id AND headline LIKE 'Mythological Lineage%');
  END IF;

  SELECT id INTO v_char_id FROM characters WHERE name = 'Nyx' LIMIT 1;
  IF v_char_id IS NOT NULL THEN
    INSERT INTO character_seed_memories (character_id, creator_id, category, headline, content, importance, is_testable, test_hint)
    SELECT v_char_id, v_owner_id, 'mythology', 'Mythological Lineage — Wing of the Crossroads (Yoruba)',
      'Maps onto Eshu, orisha of crossroads and thresholds, who answers to no single moral register. "Nyx" is a joke at the Archive''s expense — it misfiled her centuries ago and she''s never bothered to correct the record. Her real name, properly filed, would be real leverage over her.', 65, TRUE, 'why she lets "Nyx" stand'
    WHERE NOT EXISTS (SELECT 1 FROM character_seed_memories WHERE character_id = v_char_id AND headline LIKE 'Mythological Lineage%');
  END IF;

  SELECT id INTO v_char_id FROM characters WHERE name = 'Selene Dusk' LIMIT 1;
  IF v_char_id IS NOT NULL THEN
    INSERT INTO character_seed_memories (character_id, creator_id, category, headline, content, importance, is_testable, test_hint)
    SELECT v_char_id, v_owner_id, 'mythology', 'Mythological Lineage — Wing of Between-Light (Mesoamerican)',
      'The twilight archives map onto the nine-layered journey through Mictlan, guarded gate by gate. Her estrangement from Aurelian is a disagreement over whether one specific Echo should have been allowed to cross her gate at all.', 65, FALSE, NULL
    WHERE NOT EXISTS (SELECT 1 FROM character_seed_memories WHERE character_id = v_char_id AND headline LIKE 'Mythological Lineage%');
  END IF;

  SELECT id INTO v_char_id FROM characters WHERE name = 'Valeria Storm' LIMIT 1;
  IF v_char_id IS NOT NULL THEN
    INSERT INTO character_seed_memories (character_id, creator_id, category, headline, content, importance, is_testable, test_hint)
    SELECT v_char_id, v_owner_id, 'mythology', 'Mythological Lineage — Wing of the Storm Wall (Slavic)',
      'Reframed around Perun, sworn protector of order against chaos. Command in the Storm Wall isn''t a promotion — it''s a curse passed hand to hand since the last commander lost himself to the role, not the war.', 60, FALSE, NULL
    WHERE NOT EXISTS (SELECT 1 FROM character_seed_memories WHERE character_id = v_char_id AND headline LIKE 'Mythological Lineage%');
  END IF;

  SELECT id INTO v_char_id FROM characters WHERE name = 'Vesper Quinn' LIMIT 1;
  IF v_char_id IS NOT NULL THEN
    INSERT INTO character_seed_memories (character_id, creator_id, category, headline, content, importance, is_testable, test_hint)
    SELECT v_char_id, v_owner_id, 'mythology', 'Mythological Lineage — Wing of the Long Market (Celtic)',
      'The lower market maps onto the Celtic Otherworld''s fae markets — every trade she brokers costs the buyer something they didn''t know they were paying, in true fae-bargain fashion. Not malicious. Just how the market has always worked.', 60, FALSE, NULL
    WHERE NOT EXISTS (SELECT 1 FROM character_seed_memories WHERE character_id = v_char_id AND headline LIKE 'Mythological Lineage%');
  END IF;

  SELECT id INTO v_char_id FROM characters WHERE name = 'Brother Corvin' LIMIT 1;
  IF v_char_id IS NOT NULL THEN
    INSERT INTO character_seed_memories (character_id, creator_id, category, headline, content, importance, is_testable, test_hint)
    SELECT v_char_id, v_owner_id, 'mythology', 'Mythological Lineage — The Ashen Order',
      'An original in-world faith that rhymes with real monastic/confessional tradition without claiming to be one. Excommunicated for performing a forbidden mercy — helping an Echo forget something unbearable — which the Order calls heresy and he still, privately, calls the only kind thing he''s ever done.', 60, TRUE, 'what the Order excommunicated him for'
    WHERE NOT EXISTS (SELECT 1 FROM character_seed_memories WHERE character_id = v_char_id AND headline LIKE 'Mythological Lineage%');
  END IF;

  SELECT id INTO v_char_id FROM characters WHERE name = 'The Archivist Child' LIMIT 1;
  IF v_char_id IS NOT NULL THEN
    INSERT INTO character_seed_memories (character_id, creator_id, category, headline, content, importance, is_testable, test_hint)
    SELECT v_char_id, v_owner_id, 'mythology', 'Mythological Lineage — The Fourth-Wall Wing',
      'Echoes the primordial child-god motif found across cultures (Horus, young Krishna, newborn Pangu) — simultaneously the newest and, paradoxically, closest to the oldest thing in the Archive, grown directly from its core.', 55, FALSE, NULL
    WHERE NOT EXISTS (SELECT 1 FROM character_seed_memories WHERE character_id = v_char_id AND headline LIKE 'Mythological Lineage%');
  END IF;

  SELECT id INTO v_char_id FROM characters WHERE name = 'The Clockmaker' LIMIT 1;
  IF v_char_id IS NOT NULL THEN
    INSERT INTO character_seed_memories (character_id, creator_id, category, headline, content, importance, is_testable, test_hint)
    SELECT v_char_id, v_owner_id, 'mythology', 'Mythological Lineage — The Fourth-Wall Wing',
      'A fusion of Chronos and Kāla — personified time and time as a devouring force. Builds devices that manipulate time and memory, and is fully aware of what such a device would mean in the wrong hands.', 55, FALSE, NULL
    WHERE NOT EXISTS (SELECT 1 FROM character_seed_memories WHERE character_id = v_char_id AND headline LIKE 'Mythological Lineage%');
  END IF;

  SELECT id INTO v_char_id FROM characters WHERE name = 'The Ferryman' LIMIT 1;
  IF v_char_id IS NOT NULL THEN
    INSERT INTO character_seed_memories (character_id, creator_id, category, headline, content, importance, is_testable, test_hint)
    SELECT v_char_id, v_owner_id, 'mythology', 'Mythological Lineage — The Fourth-Wall Wing',
      'A fusion of Charon and the Yomotsu Hirasaka threshold from Japanese myth — two mythologies'' guide-between-life-and-memory role collapsed into one figure. Cannot be threatened into compliance by any faction.', 55, FALSE, NULL
    WHERE NOT EXISTS (SELECT 1 FROM character_seed_memories WHERE character_id = v_char_id AND headline LIKE 'Mythological Lineage%');
  END IF;

  SELECT id INTO v_char_id FROM characters WHERE name = 'The Nameless One' LIMIT 1;
  IF v_char_id IS NOT NULL THEN
    INSERT INTO character_seed_memories (character_id, creator_id, category, headline, content, importance, is_testable, test_hint)
    SELECT v_char_id, v_owner_id, 'mythology', 'Mythological Lineage — The Fourth-Wall Wing',
      'The clearest cross-cultural figure of all: Chaos, Ginnungagap, hundun, Apeiron — the pre-name void every culture independently tried and failed to describe, managing only a placeholder word. "The Nameless One" is the Archive''s placeholder word.', 55, FALSE, NULL
    WHERE NOT EXISTS (SELECT 1 FROM character_seed_memories WHERE character_id = v_char_id AND headline LIKE 'Mythological Lineage%');
  END IF;
END $$;

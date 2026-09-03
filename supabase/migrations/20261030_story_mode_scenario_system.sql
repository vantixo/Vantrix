-- ─────────────────────────────────────────────────────────────────────────────
-- Roleplay System — Scenario-driven Story Mode
--
-- Existing chat is one character, freeform, no plot. This adds a structured
-- narrative layer on top of the SAME conversation/message thread (mirrors
-- the `dating_mode` pattern already on `conversations` — a mode flag, not a
-- parallel product):
--
--   roleplay_scenarios — curated story templates (genre, premise, tone,
--     chapter count). Universal: character_id is nullable, so any scenario
--     can be played with any character — the character's own personality
--     (via assembleCharacterPrompt) drives HOW they inhabit the role.
--
--   roleplay_sessions  — one run of a scenario against one conversation.
--     Tracks chapter/beat progress and a lightweight scene_state bag.
--     Partial unique index enforces at most one ACTIVE session per
--     conversation at a time (switching scenarios abandons the old one).
--
--   roleplay_beats     — structured turn log (narration / user action /
--     chapter-end), one row per exchange, linked to the underlying
--     `messages` row so the conversation's history stays a single
--     coherent thread whether the user is in Story Mode or freeform chat.
--
-- `conversations` gets two new nullable-safe columns, same shape as the
-- existing `dating_mode BOOLEAN` column.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── roleplay_scenarios ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS roleplay_scenarios (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                TEXT        NOT NULL,
  title               TEXT        NOT NULL,
  tagline             TEXT        NOT NULL,
  genre               TEXT        NOT NULL,
  tags                TEXT[]      NOT NULL DEFAULT '{}',
  premise             TEXT        NOT NULL,
  setting             TEXT        NOT NULL,
  tone                TEXT        NOT NULL,
  opening_narration   TEXT        NOT NULL,
  -- NULL = universal template, playable with any character. Set only for a
  -- scenario purpose-built around one specific character.
  character_id        UUID        REFERENCES characters(id) ON DELETE CASCADE,
  chapter_count       SMALLINT    NOT NULL DEFAULT 5,
  cover_image_url     TEXT,
  min_tier            TEXT        NOT NULL DEFAULT 'free' CHECK (min_tier IN ('free', 'premium')),
  is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
  sort_order          SMALLINT    NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_roleplay_scenarios_slug ON roleplay_scenarios (slug);
CREATE INDEX IF NOT EXISTS idx_roleplay_scenarios_active ON roleplay_scenarios (is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_roleplay_scenarios_character ON roleplay_scenarios (character_id) WHERE character_id IS NOT NULL;

ALTER TABLE roleplay_scenarios ENABLE ROW LEVEL SECURITY;

-- Catalog is public-read for any authenticated user (gating on tier happens
-- in application code, same as MOOD_ROOMS — this table isn't the enforcement
-- point). Writes go through supabaseAdmin only (admin panel / this migration).
CREATE POLICY "roleplay_scenarios_read_active" ON roleplay_scenarios
  FOR SELECT USING (is_active = TRUE);

-- ── roleplay_sessions ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS roleplay_sessions (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id           UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  character_id      UUID        NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  scenario_id       UUID        NOT NULL REFERENCES roleplay_scenarios(id) ON DELETE RESTRICT,
  status            TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned')),
  current_chapter   SMALLINT    NOT NULL DEFAULT 1,
  beat_count        INTEGER     NOT NULL DEFAULT 0,
  -- Lightweight, extensible state bag (location / time-of-day / mood /
  -- free-form flags). Deliberately NOT a full world-simulation object like
  -- src/lib/universe/* — this is per-session narrative continuity, not
  -- another simulated economy.
  scene_state       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  last_cliffhanger  TEXT,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ
);

-- At most one ACTIVE session per conversation — starting a new scenario on
-- a conversation that already has one running must explicitly abandon the
-- old one first (enforced in lib/roleplay/engine.ts), not silently fork.
CREATE UNIQUE INDEX IF NOT EXISTS idx_roleplay_sessions_one_active_per_conversation
  ON roleplay_sessions (conversation_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_roleplay_sessions_user ON roleplay_sessions (user_id, status);
CREATE INDEX IF NOT EXISTS idx_roleplay_sessions_conversation ON roleplay_sessions (conversation_id);

ALTER TABLE roleplay_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "roleplay_sessions_owner_select" ON roleplay_sessions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "roleplay_sessions_owner_insert" ON roleplay_sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "roleplay_sessions_owner_update" ON roleplay_sessions
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── roleplay_beats ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS roleplay_beats (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID        NOT NULL REFERENCES roleplay_sessions(id) ON DELETE CASCADE,
  user_id           UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- Nullable + ON DELETE SET NULL: the beat record (narration text, choices
  -- offered) is worth keeping for session replay/analytics even if the
  -- underlying message row is later purged by message-retention cleanup
  -- (see 20260812_conversation_dedupe_and_message_retention.sql).
  message_id        UUID        REFERENCES messages(id) ON DELETE SET NULL,
  beat_number       INTEGER     NOT NULL,
  chapter           SMALLINT    NOT NULL,
  beat_type         TEXT        NOT NULL CHECK (beat_type IN ('narration', 'user_turn', 'chapter_end')),
  narrator_text     TEXT,
  action_type       TEXT        CHECK (action_type IN ('say', 'do', 'choice')),
  choices           JSONB,
  choice_selected   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_roleplay_beats_session ON roleplay_beats (session_id, beat_number);
CREATE INDEX IF NOT EXISTS idx_roleplay_beats_user ON roleplay_beats (user_id);

ALTER TABLE roleplay_beats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "roleplay_beats_owner_select" ON roleplay_beats
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "roleplay_beats_owner_insert" ON roleplay_beats
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ── conversations: mode flag + pointer to the active session ───────────────
-- Same shape as the existing `dating_mode BOOLEAN` column — a mode toggle
-- on the one conversation thread per (user, character), not a separate
-- parallel chat surface.

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS roleplay_mode BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS roleplay_session_id UUID REFERENCES roleplay_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_roleplay_mode
  ON conversations (roleplay_mode) WHERE roleplay_mode = TRUE;

-- ── Seed catalog ─────────────────────────────────────────────────────────────
-- 12 universal scenario templates (character_id NULL — playable with any
-- character). Roughly half free / half premium, mirroring the MOOD_ROOMS
-- free/premium split in scene-data.ts.

INSERT INTO roleplay_scenarios
  (slug, title, tagline, genre, tags, premise, setting, tone, opening_narration, chapter_count, min_tier, sort_order)
VALUES
  (
    'the-heist',
    'The Heist',
    'One night. One vault. No second chances.',
    'heist',
    ARRAY['adventure','tension','partners-in-crime'],
    'You and your partner have thirty minutes inside the vault before the night guard''s rotation brings them back to this wing. Everything up to now has been planning. This is the part that goes wrong.',
    'A private bank''s sub-basement vault, ten minutes before closing time',
    'tense, fast, dry-humored under pressure',
    'The vault door clicks open on the last try of the night. Behind you, the hallway is empty for exactly as long as the guard''s smoke break lasts — call it four minutes. *They* are already inside, gloved hands hovering over the first deposit box, not looking back at you. "Clock''s running," they say, voice low. "Tell me we''re doing this."',
    5, 'free', 10
  ),
  (
    'letters-from-the-front',
    'Letters From the Front',
    'A war, an ocean, and a year of letters that became the realest thing in either of your lives.',
    'historical romance',
    ARRAY['slow-burn','wartime','longing'],
    'You have never met in person. Everything between you exists on paper — a year of letters that started as morale-boosting duty and became the thing you both wait for. Now leave has finally come through.',
    'A train platform, a European city, late 1944',
    'aching, tender, restrained',
    'You have read the handwriting a hundred times but never seen the hand that made it. The platform is crowded with people who know exactly who they''re waiting for. You do not — not really — and then a soldier near the far column stops walking, looks straight at you, and goes very still, like they''re afraid you''re something that will disappear if they move.',
    6, 'premium', 20
  ),
  (
    'the-last-bookstore-on-elm-street',
    'The Last Bookstore on Elm Street',
    'The shop is closing at the end of the month. You have four weeks to figure out what you actually want to say.',
    'slice of life romance',
    ARRAY['cozy','slow-burn','found-time'],
    'You have worked the same closing shift together for two years without ever saying the thing. The bookstore lost its lease. This is one of your last nights doing inventory together, and neither of you is in a hurry to finish it.',
    'A small independent bookstore after closing, rain outside',
    'warm, wistful, quietly funny',
    'The "closed" sign has been turned for twenty minutes and neither of you has started on the inventory list. *They* are sitting cross-legged on the floor between two shelves, flipping through a book you know they''ve already read three times, clearly using it as an excuse to not go home yet. "So," they say, not looking up, "are we going to talk about the fact that this is one of our last ones of these?"',
    4, 'free', 30
  ),
  (
    'midnight-precinct',
    'Midnight Precinct',
    'A case gone cold, a partner you don''t fully trust, and a body that shouldn''t exist.',
    'noir mystery',
    ARRAY['mystery','banter','moral-grey'],
    'A body turned up in a district that officially doesn''t have crime — the kind of case someone higher up wants closed quietly and fast. You have twelve hours before it gets taken off your desk. Your partner already knows more than they''re saying.',
    'A rain-slicked precinct office, 2 a.m.',
    'sharp, atmospheric, wry',
    'The case file is thinner than it should be — pages missing, or never written. *They* drop a coffee on your desk you didn''t ask for and lean against the frame like they''ve got all night, which, at this hour, they do. "You''re going to want to sit down for this," they say. "The lab called back on the prints. That''s the problem — there shouldn''t be any prints to call about."',
    5, 'premium', 40
  ),
  (
    'the-academy-of-hidden-things',
    'The Academy of Hidden Things',
    'You were not supposed to find the door behind the library. Now you cannot stop thinking about what was through it.',
    'fantasy academy',
    ARRAY['magic','mystery','found-family'],
    'The academy has a floor that officially does not exist. You found the stairwell by accident during exam week, and so did they. Neither of you has reported it. Both of you are curious enough — or reckless enough — to go back.',
    'A centuries-old magic academy, the night before midterms',
    'wondrous, a little reckless, warm underneath',
    'The stairwell is exactly where you left it, which somehow feels more unsettling than if it had vanished. *They* are already there when you arrive, one hand on the wall like they''re listening to something you can''t hear. "It''s warmer tonight," they say, without turning around. "I don''t think that''s a good sign. Are you coming, or are we finally being sensible about this?"',
    6, 'free', 50
  ),
  (
    'shipwrecked',
    'Shipwrecked',
    'The boat is gone. The island isn''t on any chart. You have exactly each other.',
    'survival adventure',
    ARRAY['survival','forced-proximity','high-stakes'],
    'The storm took the boat and half your supplies with it. Whatever this island is, it isn''t on any chart either of you has seen. The only certainty left is the person who washed up on the same stretch of sand you did.',
    'An uncharted island, the morning after a storm',
    'raw, high-stakes, quietly intimate',
    'Salt water, a headache, and the sound of someone dragging driftwood a few feet away — that''s what wakes you. *They* look up, relief crossing their face fast before they cover it. "I thought I was going to have to do this alone," they say, sitting back on their heels. "Can you stand? We need to find water before we do anything else."',
    6, 'premium', 60
  ),
  (
    'the-understudy',
    'The Understudy',
    'You have hated each other since callbacks. Opening night is in six hours and the lead just lost their voice.',
    'showbiz rivals-to-lovers',
    ARRAY['rivals','banter','high-energy'],
    'You and your understudy rival have spent the whole run trying to outshine each other from the wings. Now the lead is out sick, the show goes on regardless, and one of you is about to get the part neither of you thought would actually happen.',
    'Backstage, a theater, six hours before curtain',
    'high-energy, sharp banter, secretly soft',
    'The stage manager''s announcement is still echoing when *they* rounds the corner into the dressing room, already half out of their rehearsal clothes. "Don''t," they say, pointing at you before you''ve said a word, "do not make this weird. I know you wanted this too. We don''t have time to make it weird. What''s our blocking for act one?"',
    4, 'free', 70
  ),
  (
    'six-months-on-mars',
    'Six Months on Mars',
    'Two people, one habitat module, and a four-minute delay before Earth hears a single word either of you says.',
    'sci-fi isolation drama',
    ARRAY['isolation','slow-burn','close-quarters'],
    'The rest of the crew is asleep in the other module. Mission control is a four-minute delay away, which for all practical purposes means it isn''t there at all right now. It is just the two of you, three months into six, and the conversation you have been avoiding since launch.',
    'A Mars habitat module, ship-night cycle',
    'quiet, intimate, contemplative',
    'The module lights have dimmed to ship-night, and the window shows nothing but red-brown dark and a sky with too many stars in it. *They* are still awake, sitting by the porthole with their knees pulled up. "Four minutes each way," they say, not turning around. "That''s how long it''d take to tell Earth what I''m thinking right now. Feels like a strange amount of time to have to wait for anything, doesn''t it?"',
    6, 'premium', 80
  ),
  (
    'the-arranged-engagement',
    'The Arranged Engagement',
    'The wedding was announced before either of you had said a single word to each other. Tonight is your first.',
    'royal court drama',
    ARRAY['court-intrigue','slow-burn','forced-proximity'],
    'Your engagement was arranged for reasons that had nothing to do with either of you — an alliance, a treaty, a court that needed the appearance of unity. Tonight is the first private moment the schedule has allowed you, and neither of you knows the other at all yet.',
    'A private garden terrace within the palace grounds, evening',
    'formal on the surface, charged underneath',
    'The guards posted at the terrace entrance are the only acknowledgment that this meeting was arranged at all — everything else has been left deliberately, carefully informal. *They* rise as you approach, a little more nervous than court etiquette would ever admit to. "I realized today," they say, "that I know your title, your house, and your signature on the treaty documents. I don''t know a single thing about you. I''d like to fix that, if you''re willing."',
    5, 'premium', 90
  ),
  (
    'neon-district',
    'Neon District',
    'You hacked something you weren''t supposed to see. Now someone with a lot of money wants it back.',
    'cyberpunk thriller',
    ARRAY['thriller','tech-noir','tension'],
    'A routine job turned up a data fragment that was never supposed to leave the corporate mainframe. Within the hour, the people looking for it knew your name. The only reason you''re still breathing is the person who found you first — and they want something for it.',
    'A rain-lit rooftop above the Neon District, after curfew',
    'electric, dangerous, fast-talking',
    'The rooftop access door is still smoking slightly from how you got through it. *They* are already there, backlit by a wall of ads three stories tall, watching the street below with the kind of stillness that means they''ve done this before. "You''re either the bravest idiot in the district or the smartest," they say without turning around, "and I need to know which before I decide whether to help you disappear."',
    6, 'premium', 100
  ),
  (
    'the-reunion',
    'The Reunion',
    'Ten years, one high school reunion, and the person you never really got over.',
    'second-chance romance',
    ARRAY['second-chance','nostalgia','banter'],
    'You have not spoken in ten years, not since the falling-out neither of you ever properly explained. Now you are both standing in the same repurposed gymnasium, name tags on, and there is exactly one open seat left in the room — right next to them.',
    'A ten-year high school reunion, a decorated gymnasium',
    'nostalgic, funny, quietly vulnerable',
    'The DJ is playing something that was popular your senior year, and you both clock it at the same time from opposite sides of the room. *They* raise their drink in your direction, equal parts amused and unsure. "I saved you a seat before I remembered why that might be a bad idea," they call over, nodding at the empty chair beside them. "Sit anyway?"',
    4, 'free', 110
  ),
  (
    'werewolves-of-ashford',
    'Werewolves of Ashford',
    'Something has been killing livestock on the edge of town, and the new arrival everyone''s suspicious of just offered to help you find it.',
    'supernatural mystery',
    ARRAY['supernatural','mystery','tension'],
    'Three sheep dead in a week, torn apart by something the local hunters can''t track. The town has already decided who to blame: the newcomer who arrived the same week the killings started. They say they can help you find the real culprit — if you''re willing to trust them enough to go looking after dark.',
    'The wooded edge of a small town, dusk',
    'moody, suspenseful, slow-building trust',
    'The tree line goes quiet in a way that doesn''t feel natural, and *they* stop walking just ahead of you, head tilted like they''re listening to something the wind carried. "You should probably know," they say carefully, not quite looking at you, "that trusting me tonight is going to ask more of you than you think it will. I''d still like you to. Are you coming?"',
    5, 'premium', 120
  )
ON CONFLICT (slug) DO NOTHING;

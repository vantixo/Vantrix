-- ─────────────────────────────────────────────────────────────────────────────
-- Roleplay <-> World/Factions linkage
--
-- roleplay_scenarios (20261030_story_mode_scenario_system.sql) already links
-- to a single character via character_id, but had no way to be scoped to a
-- world_locations or factions row. The World hub's Location and Faction
-- detail pages (lib/frontend/world.ts / world-atlas.ts) had a full read
-- model — governance, economy, residents, members — but zero path into the
-- actual Story Mode engine (roleplay_sessions/roleplay_beats): the only
-- roleplay entry points were Home's Popular Scenarios (universal, no place
-- tie) and a character's own profile. This adds that missing tie so a
-- location/faction page can surface "Scenarios Here" and hand off into the
-- existing /roleplay/new?scenario=<slug> flow, unchanged otherwise.
--
-- Nullable + ON DELETE SET NULL on both: a scenario doesn't require a place
-- (existing universal templates keep location_slug/faction_slug NULL), and
-- deleting a location/faction later shouldn't cascade-delete a scenario,
-- just unscope it back to universal.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE roleplay_scenarios
  ADD COLUMN IF NOT EXISTS location_slug TEXT REFERENCES world_locations(slug) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS faction_slug  TEXT REFERENCES factions(slug)        ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_roleplay_scenarios_location ON roleplay_scenarios (location_slug) WHERE location_slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_roleplay_scenarios_faction  ON roleplay_scenarios (faction_slug)  WHERE faction_slug  IS NOT NULL;

-- Seed four scenarios against real seeded locations/factions
-- (20240200_world_expansion.sql) so the new "Scenarios Here" sections have
-- something real to show immediately rather than shipping empty.
INSERT INTO roleplay_scenarios
  (slug, title, tagline, genre, tags, premise, setting, tone, opening_narration,
   chapter_count, min_tier, sort_order, location_slug, faction_slug)
VALUES
  (
    'undercroft-after-hours',
    'Undercroft After Hours',
    'The lower city doesn''t sleep — it just gets quieter.',
    'moody romance',
    ARRAY['undercroft','after-hours','atmospheric'],
    'You came down into the Undercroft looking for them, following directions that got vaguer the deeper you went. You found the place — a room lit by strung bulbs over a bar nobody official knows exists.',
    'A half-hidden bar in the Undercroft, well past midnight, low light and lower ceilings',
    'atmospheric, a little dangerous, warm underneath it',
    '*They* spot you from across the room before you spot them — of course they do, this is their part of the city. *They* peel off the wall and close the distance unhurried, like they knew you''d find your way down eventually. "You actually came," they say, low enough to stay under the noise. "Most people ask for directions here and lose their nerve. Sit. First one''s on the house — you''ve earned it."',
    3, 'free', 30, 'the-undercroft', NULL
  ),
  (
    'cloudspire-rooftop-launch',
    'Cloudspire Rooftop Launch',
    'Champagne, skyline, and a reason to be there together.',
    'glamour romance',
    ARRAY['cloudspire','party','ambition'],
    'A product launch on top of one of Cloudspire''s glass towers, the kind of event where everyone is networking and nobody is relaxed — except, somehow, the two of you found a quiet corner of the roof to yourselves.',
    'A rooftop bar atop a Cloudspire tower, string lights, the city glittering below',
    'glossy, charged, quietly intimate',
    'The party noise thins out near the railing, where *they* found you first — two glasses of something expensive balanced in one hand. "I was told to network tonight," they say, handing you a glass, "and this is the best conversation I''ve had all evening. Don''t take that as a low bar — take it as an invitation to keep going."',
    3, 'premium', 31, 'cloudspire', NULL
  ),
  (
    'protocol-all-nighter',
    'The Protocol All-Nighter',
    'A deadline, a locked lab, and just the two of you.',
    'slow-burn romance',
    ARRAY['the-protocol','late-night','collaborative'],
    'The Protocol''s shared workspace has emptied out for the night except for the two of you, racing a deadline neither of you will admit you extended on purpose for an excuse to stay later together.',
    'A dim, equipment-lined workspace, screens the only light left on at 1 a.m.',
    'focused, easy, quietly flirtatious',
    '*They* push back from the terminal and stretch, cracking their neck. "Committed to the bit or actually planning to sleep tonight?" they ask, nodding at your screen. "Because if it''s the former, I know a much better use of the next hour than staring at a compiler."',
    3, 'free', 32, NULL, 'the-protocol'
  ),
  (
    'unseen-invitation',
    'An Unseen Invitation',
    'Nobody admits to membership. You just got invited anyway.',
    'mystery romance',
    ARRAY['the-unseen','secrets','tension'],
    'A note with no signature told you to be here at this hour. *They* were the one waiting — which answers one question about who sent it, and raises several more you are not sure they will answer honestly.',
    'An unmarked back room, single low lamp, door closed behind you',
    'charged, secretive, magnetic',
    '*They* don''t look up right away, letting the silence stretch just long enough to be deliberate. "You came alone," they finally say, "good — that was the one condition." *They* finally meet your eyes, something unreadable and interested underneath it. "I have questions about how much you want to know. But first: how much do you already suspect?"',
    3, 'premium', 33, NULL, 'the-unseen'
  )
ON CONFLICT (slug) DO NOTHING;

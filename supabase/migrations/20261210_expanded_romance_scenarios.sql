-- ─────────────────────────────────────────────────────────────────────────────
-- Expanded Story Mode catalog — harder, higher-stakes romance
--
-- Home's Popular Scenarios (20261120) shipped four "drop into a mood" quick
-- scenes, and 20261124 added four faction/location-scoped scenes reachable
-- only from the World hub. Both sets stayed emotionally low-stakes (a first
-- date, a beach afternoon) or scoped to a single faction/location each.
-- This adds eight more: four new universal scenes with real conflict —
-- reconciliation, distance, meeting family, a confession that could go
-- badly — and four new faction-scoped scenes covering the three factions
-- (council-of-seven, iron-compact, old-families) and the location
-- (the-archive) that had zero scenes tied to them until now.
--
-- sort_order 5-8 (universal) / 9-12 (faction-scoped) continues directly
-- after the existing 1-4 — see PopularScenarios/listHomeScenarios(12) on
-- Home, which now pulls a 12-tile catalog instead of the original static
-- 4, so all eight of these surface there automatically alongside the
-- existing ones instead of being reachable only from a character page or
-- the World hub.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO roleplay_scenarios
  (slug, title, tagline, genre, tags, premise, setting, tone, opening_narration,
   chapter_count, min_tier, sort_order, location_slug, faction_slug)
VALUES
  (
    'the-apology',
    'The Apology',
    'You said things you meant and things you didn''t. Time to find out which was which.',
    'reconciliation romance',
    ARRAY['conflict', 'vulnerable', 'higher-stakes'],
    'The fight two nights ago hasn''t been mentioned since — both of you letting the silence do the work neither wanted to do out loud. Tonight one of you finally reached out. This conversation goes one of two ways, and neither of you knows yet which.',
    'Your place, evening, the door just closed behind them',
    'tense at first, raw, working its way toward tender',
    '*They* stand just inside the doorway like they haven''t decided if they''re staying, coat still on. "I''ve rehearsed this about six different ways on the drive over," *they* say, not quite meeting your eyes yet, "and I''m not going to get it perfect. But I didn''t mean what I said Tuesday — not the part that mattered, anyway. Can I try again?"',
    4, 'free', 5, NULL, NULL
  ),
  (
    'long-distance-reunion',
    'Long Distance, One Night',
    'Four months of a screen between you. Tonight there isn''t one.',
    'reunion romance',
    ARRAY['long-distance', 'anticipation', 'higher-stakes'],
    'Four months of time zones and bad video calls end tonight — one layover, one arrivals gate, and the specific nervous energy of finally getting to close a distance that''s been purely theoretical for a season.',
    'Arrivals gate, late evening, a crowd thinning around you both',
    'electric, a little disbelieving, overwhelmed in the good way',
    '*They* clear the sliding doors and stop dead the second they spot you, like the sight of you in person short-circuits something a screen never could. Then *they* are moving, fast, bag forgotten on one shoulder. "You''re actually here," *they* say into your ear, voice cracking on it in a way four months of calls never once let you hear. "Tell me you don''t have anywhere to be for the next twelve hours."',
    4, 'premium', 6, NULL, NULL
  ),
  (
    'meeting-the-family',
    'Meeting the Family',
    'Dinner with the people whose opinion actually counts.',
    'high-stakes romance',
    ARRAY['family', 'nervous', 'higher-stakes'],
    'This dinner has been rescheduled twice already — both times by you, both times out of nerves you didn''t fully admit to. Tonight it''s happening. Whatever happens at that table, it changes how serious this is about to become.',
    'A family dining room, table half-set, voices audible from the kitchen',
    'nervous, warm underneath the pressure, a little conspiratorial',
    '*They* catch you by the elbow just before the kitchen door, dropping their voice under the noise of pans and a sibling arguing about something. "Hey — breathe," *they* say, low, close, amused despite themself. "You look like you''re about to be sentenced, not fed. For what it''s worth, I already told them I''m serious about you. That part''s decided. This is just everyone else catching up."',
    4, 'free', 7, NULL, NULL
  ),
  (
    'the-confession',
    'The Confession',
    'You''ve been sitting on this for weeks. Tonight it comes out, on purpose or not.',
    'slow-burn romance',
    ARRAY['confession', 'risk', 'higher-stakes'],
    'You''ve rehearsed saying it a dozen times and chickened out a dozen times. Tonight the conversation is heading there whether you steer it or not — the kind of honesty that either changes everything between you or makes the next month unbearably awkward.',
    'A quiet corner, late, the rest of the noise elsewhere',
    'charged, hesitant, dangerously close to honest',
    '*They* go quiet in the specific way that means they noticed you almost said something and didn''t. "You''ve done that three times tonight," *they* say finally, turning to actually face you instead of the room. "Started a sentence and swallowed it. I''m not going to make you finish it if you''re not ready — but I''d be lying if I said I wasn''t hoping you would."',
    5, 'premium', 8, NULL, NULL
  ),
  (
    'council-after-hours',
    'Council Chambers, After Hours',
    'The seat of power, emptied out, and the one person who never fully leaves it.',
    'power romance',
    ARRAY['council-of-seven', 'ambition', 'higher-stakes'],
    'The chamber cleared out an hour ago — everyone except the one member who never quite leaves before the building''s own security does. You came back for a forgotten folder and found them still at the long table, alone with the day''s decisions.',
    'The Council chamber, long table, most of the lights already down',
    'formal cooling into private, sharp, quietly magnetic',
    '*They* don''t look up right away, still turning a pen between two fingers, silhouetted against the one lamp still lit at the head of the table. "Everyone else gets to leave their vote in this room," *they* say, finally meeting your eyes with something unguarded that the chamber never sees. "I never quite manage it. Sit — you''re the only company in this building I don''t have to perform for."',
    4, 'premium', 9, NULL, 'council-of-seven'
  ),
  (
    'held-together',
    'Held Together',
    'A picket line, a cold night, and a reason to stand closer than the wind requires.',
    'solidarity romance',
    ARRAY['iron-compact', 'working-class', 'higher-stakes'],
    'The line has been out front of Iron Reach''s gates since dawn, and it is going to be a long, cold night before this gets resolved. Somewhere around hour six, the two of you ended up shoulder to shoulder at the same fire barrel, and neither of you has moved.',
    'A picket line outside Iron Reach, fire barrel, night settling in',
    'gritty, warm despite the cold, quietly devoted',
    '*They* pass you the thermos without being asked, knuckles brushing yours in the handoff. "Six hours and you haven''t once talked about going home," *they* say, watching you over the rim of their own cup, something admiring underneath the exhaustion. "I could say the same about myself, and I don''t think it''s only about the contract anymore. You warm enough, or is that a lie you''re telling both of us?"',
    3, 'free', 10, NULL, 'iron-compact'
  ),
  (
    'old-families-masquerade',
    'The Old Families'' Masquerade',
    'A mask hides your face, not what you feel underneath it.',
    'forbidden romance',
    ARRAY['old-families', 'masquerade', 'higher-stakes'],
    'The Old Families'' annual masquerade runs on unspoken rules older than either of you — who dances with whom, who is and isn''t considered a suitable match. You were never supposed to end up talking to them all night. You did anyway.',
    'A candlelit ballroom, masks on, an orchestra somewhere behind the noise',
    'glamorous, secretive, dangerously drawn-in',
    '*They* find you again near the terrace doors, mask tilted just enough that you can see the smile underneath it. "You''re not who I''m supposed to be spending my evening with," *they* say, quiet enough that the mask isn''t the only thing hiding this conversation. "Which is, unfortunately, the most interesting thing that''s happened at one of these in years. Dance with me anyway?"',
    4, 'premium', 11, NULL, 'old-families'
  ),
  (
    'closing-time-archive',
    'Closing Time at the Archive',
    'The stacks are closing. Neither of you has noticed the lights dimming.',
    'quiet romance',
    ARRAY['the-archive', 'intellectual', 'slow-burn'],
    'You''ve both been coming to the same reading table for weeks now — separate research, same hour, an unspoken habit neither of you has named yet. Tonight the closing announcement plays and neither of you moves to pack up.',
    'A reading room deep in the Archive stacks, one lamp left on',
    'quiet, unhurried, warmly intellectual',
    '*They* mark their page without looking up, the closing chime still fading in the stacks around you. "That''s the second time this month we''ve been the last two people in this wing," *they* say, glancing over the top of their glasses with something more amused than annoyed. "I''m starting to think one of us is stalling on purpose. I''ll admit to it if you will."',
    3, 'free', 12, 'the-archive', NULL
  )
ON CONFLICT (slug) DO NOTHING;

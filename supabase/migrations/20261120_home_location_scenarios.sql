-- ─────────────────────────────────────────────────────────────────────────────
-- Home "Popular Scenarios" — real location scenes
--
-- The Home page's PopularScenarios tiles (First Date / Late Night Talk /
-- Jealousy / At the Beach) were a static, decorative-only list — see the
-- component's own "no scenarios table/endpoint exists" comment — linking to
-- a plain character search instead of an actual scene. The real Story Mode
-- system (roleplay_scenarios / roleplay_sessions / roleplay_beats, added
-- 20261030) already existed but only had 12 longer-form story templates,
-- none matching these four.
--
-- This adds those four as universal (character_id NULL) scenarios so the
-- Home tiles can link to a real location scene instead of a search seed.
-- Deliberately shorter (3 chapters vs. the 4-6 chapter story catalog) and
-- sorted ahead of it (sort_order 1-4 vs. 10+) — these are quick "drop into
-- a mood" scenes, not the longer plotted stories.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO roleplay_scenarios
  (slug, title, tagline, genre, tags, premise, setting, tone, opening_narration, chapter_count, min_tier, sort_order)
VALUES
  (
    'first-date',
    'First Date',
    'Start your story.',
    'romance',
    ARRAY['first-date','nervous-excited','slow-burn'],
    'The two of you agreed to meet in person for the first time tonight. Every message up to now has been building toward this — now it is just the two of you, a table, and the question of whether the version you imagined matches the person across from you.',
    'A small candlelit wine bar, corner table, early evening',
    'nervous, warm, a little giddy underneath the composure',
    'The host walks you to the table and *they* look up first — a half-second of both of you recalibrating a voice you only knew through a screen into an actual person. *They* stand halfway, unsure whether a hug is too much yet, then laugh at themselves and just pull out your chair instead. "Okay," they say, sitting back down, cheeks a little pink. "You are much more nerve-wracking to look at in person. Is it too early to say that?"',
    3, 'free', 1
  ),
  (
    'late-night-talk',
    'Late Night Talk',
    'When the world is quiet.',
    'intimate drama',
    ARRAY['late-night','vulnerable','quiet'],
    'It is well past midnight and neither of you is asleep. The kind of hour that strips away small talk — what gets said now tends to be the truer version of whatever you have both been circling all week.',
    'A dim room, phone screen-light or a single lamp, 2 a.m.',
    'quiet, unguarded, tender',
    'The rest of the building has gone silent, and the only light left on is the small one by the window. *They* are curled up at the other end of the couch, chin on their knees, watching you with the specific honesty people only manage this late. "I wasn\'t going to say anything," they admit, voice low so it does not break the quiet, "but I don\'t think I can sleep until I do. Can I tell you something?"',
    3, 'free', 2
  ),
  (
    'jealousy',
    'Jealousy',
    'Will they reassure you?',
    'romantic tension',
    ARRAY['jealousy','tension','reassurance'],
    'You just watched someone else hold their attention a little too long tonight, and it has been sitting in your chest since. Nothing happened, not really — but the feeling did, and now you are alone together for the first time since.',
    'Just outside a crowded party, the noise muffled behind a closed door',
    'charged, defensive softening into honest',
    'The door shuts behind you both, cutting the party down to a dull thump through the wall. *They* read your face before you say a word and their own expression shifts — caught, then careful. "Hey," they say, reaching for your hand and stopping just short, like they are not sure it is welcome right now. "Talk to me. I saw your face in there. What did I do?"',
    3, 'premium', 3
  ),
  (
    'at-the-beach',
    'At the Beach',
    'Sun, waves and you.',
    'sunlit romance',
    ARRAY['beach','playful','sun-drenched'],
    'A free afternoon, a stretch of coastline, and nowhere either of you needs to be. The kind of ordinary day that only becomes memorable in hindsight — right now it is just heat, salt air, and easy company.',
    'A quiet beach, mid-afternoon, tide coming in',
    'playful, sun-warmed, easy',
    'The water is colder than it looked from the sand, which is exactly why *they* splashed you the second you waded in. "Absolutely worth it," they call out, already backing away with a grin, clearly unrepentant. "Your face right now — I wish you could see it. Are we doing this, or are you going to stand there being betrayed all day?"',
    3, 'free', 4
  )
ON CONFLICT (slug) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill curated portraits for 9 launch-cast characters
--
-- Source: a batch of licensed/commissioned 784x1168 portraits reviewed and
-- hand-matched against each character's locked physical description
-- (face_prompt hair/eye/ethnicity/signature-item fields) so no gender or
-- identity gets crossed — see 20260813_fix_gender_image_mismatches.sql for
-- why that check matters in this codebase specifically.
--
-- Files committed under public/images/characters/. Guarded by name + the
-- current (placeholder-or-broken) image_url, so this is a no-op for any row
-- that has since had a real portrait set another way (e.g. via
-- POST /api/admin/generate-character-portraits).
--
-- Match notes:
--   Yanefes        - candlelit bookshop, quill/manuscript, dark auburn hair,
--                     amber eyes, brass ring - direct match to face_prompt.
--   Ghost of Muru   - pre-dawn gym, hand wraps, East Asian, low-key lighting.
--   Elan            - greying dark hair, warm restaurant lighting, watch.
--   Sancea          - silver-grey beard, dark robe, wooden prayer beads.
--                     (skin tone in the portrait reads lighter than the
--                     face_prompt's "dark skin" - flagged for review.)
--   Athra           - bearded, park-bench daylight, open paperback in hand.
--   Dr. Covenant     - white coat, stethoscope, clinical daylight.
--   Bianca          - dark hair, confident/knowing expression, cafe bokeh.
--   Chef Amara      - chef whites, restaurant kitchen setting. (Portrait's
--                     hair/skin tone reads lighter than face_prompt's "deep
--                     brown skin, headwrap" - occupational match is strong,
--                     physical match is partial - flagged for review.)
--   Lylia           - MODERATE confidence only: portrait is platinum-blonde
--                     (color family matches "platinum silver"), but it's
--                     long and wavy rather than the locked "short asymmetric
--                     bob with undercut," and no motorcycle jacket/polaroid.
--                     Treat as a placeholder-improvement, not a locked match;
--                     revisit if a better one becomes available.
--
-- 10 uploaded portraits did NOT get a confident character match this round
-- (no distinguishing occupational/physical cue in the source photo lined up
-- with a documented character) and were deliberately left unassigned rather
-- than guessed. See chat summary for the list.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE characters SET image_url = '/images/characters/yanefes.jpg'
WHERE name = 'Yanefes' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/ghost-of-muru-gallery-1.jpg'
WHERE name = 'Ghost of Muru' AND image_url IN ('/images/character-placeholder.png', '/images/characters/ghost-of-muru.jpg');

UPDATE characters SET image_url = '/images/characters/elan-gallery-1.jpg'
WHERE name = 'Elan' AND image_url IN ('/images/character-placeholder.png', '/images/characters/elan.jpg');

UPDATE characters SET image_url = '/images/characters/sancea-gallery-1.jpg'
WHERE name = 'Sancea' AND image_url IN ('/images/character-placeholder.png', '/images/characters/sancea.jpg');

UPDATE characters SET image_url = '/images/characters/athra-gallery-1.jpg'
WHERE name = 'Athra' AND image_url IN ('/images/character-placeholder.png', '/images/characters/athra.jpg');

UPDATE characters SET image_url = '/images/characters/dr-covenant.jpg'
WHERE name = 'Dr. Covenant' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/bianca.jpg'
WHERE name = 'Bianca' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/chef-amara.jpg'
WHERE name = 'Chef Amara' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/lylia.jpg'
WHERE name = 'Lylia' AND (image_url IS NULL OR image_url = '/images/character-placeholder.png');

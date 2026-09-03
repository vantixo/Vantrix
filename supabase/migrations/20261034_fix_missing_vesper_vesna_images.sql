-- vesper-quinn.jpg and vesna-olaris.jpg are referenced by two Archive of
-- Echoes character rows (image_url AND avatar_url) but were never actually
-- committed to public/images/characters/uploaded/ — next/image's optimizer
-- 400s fetching a source that 404s upstream (same failure shape as the
-- svg-placeholder bug this codebase already fixed once, see
-- character_placeholder_png_not_svg.sql — different root cause there:
-- disallowed format, not a missing file). Falling back to the standard
-- placeholder rather than leaving a dead URL — matches image_url's own
-- column default (see the same migration above).
--
-- Confirmed via a full diff of every distinct /images/... path referenced
-- by characters.image_url/avatar_url against public/images/ — these two
-- were the only rows pointing at a file that doesn't exist on disk.
UPDATE characters
   SET image_url = '/images/character-placeholder.png',
       avatar_url = '/images/character-placeholder.png'
 WHERE image_url IN (
   '/images/characters/uploaded/vesper-quinn.jpg',
   '/images/characters/uploaded/vesna-olaris.jpg'
 );

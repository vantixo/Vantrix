-- ─────────────────────────────────────────────────────────────────────────────
-- Corrects 20260624_character_image_url_default.sql: that migration backfilled
-- missing character images to /images/character-placeholder.svg. next/image's
-- built-in optimizer rejects SVG sources outright —
--
--   GET /_next/image?url=%2Fimages%2Fcharacter-placeholder.svg&w=256&q=75
--   400 Bad Request — "url" parameter is valid but image type is not allowed
--
-- — unless images.dangerouslyAllowSVG is set in next.config.js, which was
-- never set (deliberately: that flag applies to every image flowing through
-- <Image> site-wide, including user-uploaded and AI-generated character
-- images, which is a real SVG/XSS surface to take on just for a placeholder).
-- Net effect: every character that fell back to the placeholder rendered as
-- a blank/broken image instead of crashing — reported as "characters appear
-- without images" after the previous fix shipped.
--
-- Switched the fallback to a PNG (public/images/character-placeholder.png,
-- rasterized from the same SVG design). This migration repairs any rows that
-- already got the broken .svg value from the original migration. Safe to run
-- whether or not that migration ever ran on this database — the UPDATE/
-- DEFAULT calls below simply match nothing if it didn't.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE characters
   SET image_url = '/images/character-placeholder.png'
 WHERE image_url = '/images/character-placeholder.svg';

ALTER TABLE characters
  ALTER COLUMN image_url SET DEFAULT '/images/character-placeholder.png';

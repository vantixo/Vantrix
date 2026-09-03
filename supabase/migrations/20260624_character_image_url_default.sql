-- ─────────────────────────────────────────────────────────────────────────────
-- Character image_url: backfill + default
--
-- characters.image_url has never had a NOT NULL constraint or a DEFAULT.
-- Any character created without an image (e.g. a draft saved before LoRA
-- generation finished, or a manually-inserted row) sits with image_url = NULL
-- indefinitely. Every page that renders a character avatar uses next/image's
-- <Image src={character.image_url} />, which throws a hard render error on a
-- null/empty src ("Image is missing required 'src' property") — caught by
-- the nearest error.tsx boundary as an unhelpful generic "Page error", with
-- no indication anywhere in the UI of what actually went wrong.
--
-- This does not change apparent the TypeScript type (Character.image_url:
-- string) — it makes that type honest at the data layer instead of merely
-- hopeful. The application-side fallback (resolveImageSrc() in
-- src/lib/utils.ts) stays in place as defense-in-depth for any other image
-- field (message photos, ad creatives, etc.) this migration doesn't cover.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Backfill existing rows -----------------------------------------------------
UPDATE characters
   SET image_url = '/images/character-placeholder.png'
 WHERE image_url IS NULL OR btrim(image_url) = '';

-- 2. Default for future inserts -------------------------------------------------
ALTER TABLE characters
  ALTER COLUMN image_url SET DEFAULT '/images/character-placeholder.png';

-- 3. Enforce going forward -------------------------------------------------------
-- Safe now that step 1 has backfilled every existing row.
ALTER TABLE characters
  ALTER COLUMN image_url SET NOT NULL;

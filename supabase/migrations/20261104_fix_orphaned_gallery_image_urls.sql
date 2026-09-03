-- ─────────────────────────────────────────────────────────────────────────────
-- Fix orphaned characters.gallery_image_urls entries
--
-- ROOT CAUSE: 20260943_fix_broken_launch_character_images.sql repointed
-- eight characters' *image_url* away from corrupt 2x2px stub files to
-- either a working "-gallery-1.jpg" file or the shared placeholder — but
-- never touched gallery_image_urls, which still references those same
-- broken/nonexistent files. The Gallery tab (character-gallery.tsx) has no
-- runtime fallback for a 404'd image (see companion code fix in this same
-- commit), so these render as literal broken-image tiles for every visitor
-- who opens that tab. Confirmed against public/images/characters/: none of
-- the seven paths below exist on disk in any form (not even as a stub).
--
-- Rumi is the one exception with a real fix available rather than just a
-- clear: 20261102_backfill_batch2_character_portraits.sql already moved
-- Rumi's *image_url* to the real uploaded/rumi.jpg portrait and left a
-- comment noting gallery_image_urls was still stale — this finishes that
-- fix, mirroring exactly what that same migration did for Hannah (image_url
-- and gallery_image_urls both pointed at uploaded/hannah.jpg).
--
-- Everyone else has no working replacement image, so their orphaned entry
-- is dropped outright rather than repointed at the placeholder — an array
-- of placeholder tiles reads worse than the tab's existing "No gallery
-- media yet" empty state, and this is a multi-item array (not one image
-- field), so leaving it empty just means it goes back to that empty state.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Rumi: point gallery at the same real portrait as image_url ────────────
UPDATE characters
SET gallery_image_urls = ARRAY['/images/characters/uploaded/rumi.jpg']
WHERE name = 'Rumi'
  AND gallery_image_urls = ARRAY['/images/characters/rumi-gallery-1.jpg'];

-- ── Lord Adrian: drop only the missing gallery-1, keep working gallery-2 ──
UPDATE characters
SET gallery_image_urls = array_remove(gallery_image_urls, '/images/characters/lord-adrian-gallery-1.jpg')
WHERE name = 'Lord Adrian'
  AND '/images/characters/lord-adrian-gallery-1.jpg' = ANY(gallery_image_urls);

-- ── No working replacement — clear the orphaned single-item arrays ────────
UPDATE characters SET gallery_image_urls = '{}'
WHERE name = 'Alexei' AND gallery_image_urls = ARRAY['/images/characters/alexei-gallery-1.jpg'];

UPDATE characters SET gallery_image_urls = '{}'
WHERE name = 'Dominik' AND gallery_image_urls = ARRAY['/images/characters/dominik-gallery-1.jpg'];

UPDATE characters SET gallery_image_urls = '{}'
WHERE name = 'Narcis' AND gallery_image_urls = ARRAY['/images/characters/narcis-gallery-1.jpg'];

UPDATE characters SET gallery_image_urls = '{}'
WHERE name = 'Professor Emeka'
  AND gallery_image_urls = ARRAY['/images/characters/professor-emeka-gallery-1.jpg', '/images/characters/professor-emeka-gallery-2.jpg'];

UPDATE characters SET gallery_image_urls = '{}'
WHERE name = 'Seraphine Vale' AND gallery_image_urls = ARRAY['/images/characters/seraphine-vale-gallery-1.jpg'];

UPDATE characters SET gallery_image_urls = '{}'
WHERE name = 'Takeshi' AND gallery_image_urls = ARRAY['/images/characters/takeshi-gallery-1.jpg'];

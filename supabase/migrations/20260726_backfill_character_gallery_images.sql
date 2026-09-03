-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill gallery_image_urls for 11 characters with a new alternate portrait
--
-- gallery_image_urls (TEXT[]) was added by 20260717_character_media_gallery.sql
-- but has never been populated. This migration appends one alternate,
-- non-primary display image per character to that array — it does not touch
-- image_url (the canonical/primary portrait) and is purely additive.
--
-- Source of truth: src/lib/characters/seeds.ts (gallery_image_urls field on
-- each of the 11 seeds below). If you edit seeds.ts, keep this file in sync
-- by hand (no codegen script for this file currently exists in the repo,
-- same caveat as 20260725_backfill_launch_character_image_urls.sql).
--
-- Guarded so re-running is a no-op once the image has already been appended
-- (checks the array does not already contain the value).
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE characters SET gallery_image_urls = array_append(gallery_image_urls, '/images/characters/ghost-of-muru-gallery-1.jpg')
WHERE name = 'Ghost of Muru' AND NOT ('/images/characters/ghost-of-muru-gallery-1.jpg' = ANY(gallery_image_urls));

UPDATE characters SET gallery_image_urls = array_append(gallery_image_urls, '/images/characters/elan-gallery-1.jpg')
WHERE name = 'Elan' AND NOT ('/images/characters/elan-gallery-1.jpg' = ANY(gallery_image_urls));

UPDATE characters SET gallery_image_urls = array_append(gallery_image_urls, '/images/characters/sancea-gallery-1.jpg')
WHERE name = 'Sancea' AND NOT ('/images/characters/sancea-gallery-1.jpg' = ANY(gallery_image_urls));

UPDATE characters SET gallery_image_urls = array_append(gallery_image_urls, '/images/characters/athra-gallery-1.jpg')
WHERE name = 'Athra' AND NOT ('/images/characters/athra-gallery-1.jpg' = ANY(gallery_image_urls));

UPDATE characters SET gallery_image_urls = array_append(gallery_image_urls, '/images/characters/rumi-gallery-1.jpg')
WHERE name = 'Rumi' AND NOT ('/images/characters/rumi-gallery-1.jpg' = ANY(gallery_image_urls));

UPDATE characters SET gallery_image_urls = array_append(gallery_image_urls, '/images/characters/narcis-gallery-1.jpg')
WHERE name = 'Narcis' AND NOT ('/images/characters/narcis-gallery-1.jpg' = ANY(gallery_image_urls));

UPDATE characters SET gallery_image_urls = array_append(gallery_image_urls, '/images/characters/alexei-gallery-1.jpg')
WHERE name = 'Alexei' AND NOT ('/images/characters/alexei-gallery-1.jpg' = ANY(gallery_image_urls));

UPDATE characters SET gallery_image_urls = array_append(gallery_image_urls, '/images/characters/takeshi-gallery-1.jpg')
WHERE name = 'Takeshi' AND NOT ('/images/characters/takeshi-gallery-1.jpg' = ANY(gallery_image_urls));

UPDATE characters SET gallery_image_urls = array_append(gallery_image_urls, '/images/characters/professor-emeka-gallery-1.jpg')
WHERE name = 'Professor Emeka' AND NOT ('/images/characters/professor-emeka-gallery-1.jpg' = ANY(gallery_image_urls));

UPDATE characters SET gallery_image_urls = array_append(gallery_image_urls, '/images/characters/dominik-gallery-1.jpg')
WHERE name = 'Dominik' AND NOT ('/images/characters/dominik-gallery-1.jpg' = ANY(gallery_image_urls));

UPDATE characters SET gallery_image_urls = array_append(gallery_image_urls, '/images/characters/lord-adrian-gallery-1.jpg')
WHERE name = 'Lord Adrian' AND NOT ('/images/characters/lord-adrian-gallery-1.jpg' = ANY(gallery_image_urls));

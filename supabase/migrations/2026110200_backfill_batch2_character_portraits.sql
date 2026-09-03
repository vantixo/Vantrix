-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill main image_url for 12 characters using batch2 avatar files.
--
-- Context: these characters already had gallery_image_urls pointing at
-- /images/characters/*-gallery-*.jpg (set by an earlier migration), but the
-- physical files were never committed to the repo, so the URLs 404'd and
-- image_url stayed on the placeholder. This migration only flips image_url
-- now that the files actually exist under public/images/characters/.
--
-- Guarded by name + current placeholder image_url, so it's a no-op for any
-- row that has since had a real portrait set another way.
--
-- Lord Adrian: only gallery-2 was supplied in this batch (gallery-1 is still
-- referenced in gallery_image_urls but its file is still missing) - using
-- gallery-2 as the main portrait since it's the only file on disk.
--
-- Rumi: gallery_image_urls still references a nonexistent rumi-gallery-1.jpg
-- (pre-existing, unrelated to this migration - left alone). The new
-- uploaded/rumi.jpg is used as the main portrait instead.
--
-- Hannah: had no gallery_image_urls at all; uploaded/hannah.jpg becomes both
-- the main portrait and her first gallery image.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE characters SET image_url = '/images/characters/astra-nocturne-gallery-1.jpg'
WHERE name = 'Astra Nocturne' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/brother-corvin-gallery-1.jpg'
WHERE name = 'Brother Corvin' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/dr-elias-voss-gallery-1.jpg'
WHERE name = 'Dr. Elias Voss' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/evelyn-thorn-gallery-1.jpg'
WHERE name = 'Evelyn Thorn' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/kael-ember-gallery-1.jpg'
WHERE name = 'Kael Ember' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/selene-dusk-gallery-1.jpg'
WHERE name = 'Selene Dusk' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/the-clockmaker-gallery-1.jpg'
WHERE name = 'The Clockmaker' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/the-ferryman-gallery-1.jpg'
WHERE name = 'The Ferryman' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/valeria-storm-gallery-1.jpg'
WHERE name = 'Valeria Storm' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/lord-adrian-gallery-2.jpg'
WHERE name = 'Lord Adrian' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/uploaded/rumi.jpg'
WHERE name = 'Rumi' AND image_url = '/images/character-placeholder.png';

UPDATE characters
SET image_url = '/images/characters/uploaded/hannah.jpg',
    gallery_image_urls = ARRAY['/images/characters/uploaded/hannah.jpg']
WHERE name = 'Hannah' AND image_url = '/images/character-placeholder.png';

-- Fix: three characters ended up rendering byte-identical portrait images
-- belonging to a *different* named character, because the underlying files
-- on disk are literal duplicates and two independent backfill migrations
-- (20261102_backfill_batch2_character_portraits.sql and
-- 20261106_backfill_character_portraits_batch4.sql) each assigned one of
-- the pair without knowing about the other:
--
--   Kael Ember   -> kael-ember-gallery-1.jpg  ==  orion-black.jpg          <- Orion Black
--   Dr Elias Voss-> dr-elias-voss-gallery-1.jpg == ivan-korrath.jpg        <- Ivan Korrath
--   Evelyn Thorn -> evelyn-thorn-gallery-1.jpg == solaris-venn.jpg         <- Solaris Venn
--
-- (Verified via md5 checksum of the actual files in public/images/characters.)
--
-- We keep the image on the character whose slug the file is literally named
-- after (Kael Ember, Dr Elias Voss, Evelyn Thorn) and revert the other three
-- to the shared placeholder rather than leave them showing someone else's
-- face. These three need a real, distinct portrait sourced/generated before
-- launch -- this migration only stops the misrepresentation, it does not
-- supply new art.

UPDATE characters
SET image_url = '/images/character-placeholder.png'
WHERE name = 'Orion Black'
  AND image_url = '/images/characters/orion-black.jpg';

UPDATE characters
SET image_url = '/images/character-placeholder.png'
WHERE name = 'Ivan Korrath'
  AND image_url = '/images/characters/ivan-korrath.jpg';

UPDATE characters
SET image_url = '/images/character-placeholder.png'
WHERE name = 'Solaris Venn'
  AND image_url = '/images/characters/solaris-venn.jpg';

-- Also strip them out of gallery_image_urls if they leaked in there too.
UPDATE characters
SET gallery_image_urls = array_remove(gallery_image_urls, '/images/characters/orion-black.jpg')
WHERE name = 'Orion Black';

UPDATE characters
SET gallery_image_urls = array_remove(gallery_image_urls, '/images/characters/ivan-korrath.jpg')
WHERE name = 'Ivan Korrath';

UPDATE characters
SET gallery_image_urls = array_remove(gallery_image_urls, '/images/characters/solaris-venn.jpg')
WHERE name = 'Solaris Venn';

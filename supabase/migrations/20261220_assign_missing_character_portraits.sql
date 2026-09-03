-- 20261220_assign_missing_character_portraits.sql
--
-- 20261215_fix_duplicate_character_portrait_images.sql reverted Orion
-- Black, Ivan Korrath, and Solaris Venn to the shared placeholder after
-- discovering they were pointing at OTHER characters' photos (Kael
-- Ember, Dr. Elias Voss, Evelyn Thorn respectively). That left all three
-- with no real portrait.
--
-- New, dedicated photos have now been sourced for each of them and
-- placed at the same filenames (public/images/characters/*.jpg), so this
-- migration just re-points image_url away from the placeholder and adds
-- the matching gallery entry. No other character's image_url is touched.

UPDATE characters
SET image_url = '/images/characters/orion-black.jpg'
WHERE name = 'Orion Black'
  AND image_url = '/images/character-placeholder.png';

UPDATE characters
SET image_url = '/images/characters/ivan-korrath.jpg'
WHERE name = 'Ivan Korrath'
  AND image_url = '/images/character-placeholder.png';

UPDATE characters
SET image_url = '/images/characters/solaris-venn.jpg'
WHERE name = 'Solaris Venn'
  AND image_url = '/images/character-placeholder.png';

-- Gallery entries (same convention as 20260726_backfill_character_gallery_images.sql)
UPDATE characters
SET gallery_image_urls = array_append(gallery_image_urls, '/images/characters/orion-black-gallery-1.jpg')
WHERE name = 'Orion Black'
  AND NOT ('/images/characters/orion-black-gallery-1.jpg' = ANY(gallery_image_urls));

UPDATE characters
SET gallery_image_urls = array_append(gallery_image_urls, '/images/characters/ivan-korrath-gallery-1.jpg')
WHERE name = 'Ivan Korrath'
  AND NOT ('/images/characters/ivan-korrath-gallery-1.jpg' = ANY(gallery_image_urls));

UPDATE characters
SET gallery_image_urls = array_append(gallery_image_urls, '/images/characters/solaris-venn-gallery-1.jpg')
WHERE name = 'Solaris Venn'
  AND NOT ('/images/characters/solaris-venn-gallery-1.jpg' = ANY(gallery_image_urls));

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill real portraits for 6 more placeholder characters (batch 4).
-- Matched by occupation/archetype the same way as batch 3
-- (20261105_backfill_character_portraits_batch3.sql). Meridian Lask and
-- Oryn Mast each get a second shot as a gallery image.
--
-- NOT used from this batch:
--   - a clockmaker workshop shot: The Clockmaker already has a real
--     portrait (the-clockmaker-gallery-1.jpg), so this would've been a
--     duplicate — same situation as the Chef Amara photo in batch 3.
--   - two exact-duplicate renders (one of the Oryn Mast shot, one of the
--     Eirene Caul shot) — redundant with the one already used.
--   - 8 images with no confident match: two "woman reading outside a
--     bookshop" shots, a street photographer, a baker, a rooftop gardener,
--     a music producer, a game/data designer, and a market-stall
--     journalist. None of the remaining placeholder characters have an
--     occupation/archetype anywhere near these — the remaining roster is
--     all fantasy/archive-of-echoes/anime or elaborate "legendary"
--     professional titles (bereavement architect, demolition ethics
--     consultant, etc.), not grounded contemporary jobs like these. Left
--     unused pending direction on whether these should become new
--     characters.
--
-- NOTE ON FILE FORMAT: the 3 images sourced from this batch's PNG uploads
-- (meridian-lask.jpg, meridian-lask-gallery-1.jpg, oryn-mast.jpg,
-- oryn-mast-gallery-1.jpg, lyra-starborn.jpg) were re-encoded to real JPEG
-- before being saved under a .jpg extension — a naive rename would have
-- shipped PNG bytes under a .jpg name and Content-Type, which is exactly
-- the class of bug this whole session has been fixing.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE characters SET image_url = '/images/characters/meridian-lask.jpg', gallery_image_urls = ARRAY['/images/characters/meridian-lask-gallery-1.jpg'] WHERE name = 'Meridian Lask' AND image_url = '/images/character-placeholder.png';
UPDATE characters SET image_url = '/images/characters/oryn-mast.jpg', gallery_image_urls = ARRAY['/images/characters/oryn-mast-gallery-1.jpg'] WHERE name = 'Oryn Mast' AND image_url = '/images/character-placeholder.png';
UPDATE characters SET image_url = '/images/characters/lyra-starborn.jpg' WHERE name = 'Lyra Starborn' AND image_url = '/images/character-placeholder.png';
UPDATE characters SET image_url = '/images/characters/orion-black.jpg' WHERE name = 'Orion Black' AND image_url = '/images/character-placeholder.png';
UPDATE characters SET image_url = '/images/characters/solaris-venn.jpg' WHERE name = 'Solaris Venn' AND image_url = '/images/character-placeholder.png';
UPDATE characters SET image_url = '/images/characters/eirene-caul.jpg' WHERE name = 'Eirene Caul' AND image_url = '/images/character-placeholder.png';
UPDATE characters SET image_url = '/images/characters/ivan-korrath.jpg' WHERE name = 'Ivan Korrath' AND image_url = '/images/character-placeholder.png';

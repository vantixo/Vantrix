-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill missing portraits for Archive of Echoes / companion characters
--
-- ROOT CAUSE: 20260821_archive_of_echoes_characters.sql (and the individual
-- companion rows added around the same time) never included an image_url
-- column in their INSERTs, so all 28 characters below have been rendering
-- the shared /images/character-placeholder.png on Home, Discover, and
-- everywhere else a character card appears — even though a real portrait
-- for every one of them has been sitting committed at
-- public/images/characters/uploaded/<slug>.jpg the entire time, just never
-- wired to the row it belongs to.
--
-- Guarded by name + the current placeholder image_url, so this is a no-op
-- for any of these rows that has since had a real portrait set some other
-- way (e.g. via POST /api/admin/generate-character-portraits).
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE characters SET image_url = '/images/characters/uploaded/calla-fendris.jpg'
WHERE name = 'Calla Fendris' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/uploaded/cassian-morrow.jpg'
WHERE name = 'Cassian Morrow' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/uploaded/cassian-rune.jpg'
WHERE name = 'Cassian Rune' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/uploaded/edric-hale.jpg'
WHERE name = 'Edric Hale' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/uploaded/eirene-caul.jpg'
WHERE name = 'Eirene Caul' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/uploaded/evelyn-thorn.jpg'
WHERE name = 'Evelyn Thorn' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/uploaded/fenris-gale.jpg'
WHERE name = 'Fenris Gale' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/uploaded/iset-vare.jpg'
WHERE name = 'Iset Vare' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/uploaded/kael-ashvane.jpg'
WHERE name = 'Kael Ashvane' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/uploaded/lev-adria.jpg'
WHERE name = 'Lev Adria' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/uploaded/lumi-crestfall.jpg'
WHERE name = 'Lumi Crestfall' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/uploaded/lyra-starborn.jpg'
WHERE name = 'Lyra Starborn' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/uploaded/mara-coldthorn.jpg'
WHERE name = 'Mara Coldthorn' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/uploaded/meridian-lask.jpg'
WHERE name = 'Meridian Lask' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/uploaded/miyu-cloudweaver.jpg'
WHERE name = 'Miyu Cloudweaver' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/uploaded/morrow-ash.jpg'
WHERE name = 'Morrow Ash' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/uploaded/nyx.jpg'
WHERE name = 'Nyx' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/uploaded/orion-black.jpg'
WHERE name = 'Orion Black' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/uploaded/oryn-mast.jpg'
WHERE name = 'Oryn Mast' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/uploaded/rael-ashmore.jpg'
WHERE name = 'Rael Ashmore' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/uploaded/ren-voidwalker.jpg'
WHERE name = 'Ren Voidwalker' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/uploaded/riona-vaugh.jpg'
WHERE name = 'Riona Vaugh' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/uploaded/sable-ashmark.jpg'
WHERE name = 'Sable Ashmark' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/uploaded/seraphine-vale.jpg'
WHERE name = 'Seraphine Vale' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/uploaded/soren-vaas.jpg'
WHERE name = 'Soren Vaas' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/uploaded/the-clockmaker.jpg'
WHERE name = 'The Clockmaker' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/uploaded/the-ferryman.jpg'
WHERE name = 'The Ferryman' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/uploaded/the-nameless-one.jpg'
WHERE name = 'The Nameless One' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/uploaded/yuki-seraph.jpg'
WHERE name = 'Yuki Seraph' AND image_url = '/images/character-placeholder.png';

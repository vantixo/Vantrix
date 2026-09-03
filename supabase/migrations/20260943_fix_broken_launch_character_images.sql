-- ─────────────────────────────────────────────────────────────────────────────
-- Fix broken launch-character images
--
-- ROOT CAUSE: 20260725_backfill_launch_character_image_urls.sql pointed 15
-- launch-cast rows at /images/characters/<slug>.jpg files that are actually
-- corrupt 2x2-pixel stub files on disk — not real portraits, not the shared
-- placeholder either, just broken images. Confirmed by inspecting every
-- file under public/images/characters/: all 15 files below are 2x2px.
--
-- Nine of the fifteen already have a full-resolution (784x1168) gallery
-- variant sitting right next to the broken file
-- (public/images/characters/<slug>-gallery-1.jpg) that nothing in the
-- schema ever pointed a character at — repointed to that working image here.
--
-- The remaining six (Bianca, Chef Amara, Dr. Covenant, Haifa, Hannah,
-- Yanefes) have no working replacement file on disk at all — repointed back
-- to the shared /images/character-placeholder.png so they render a clean
-- placeholder instead of a broken image, until a real portrait is uploaded
-- (e.g. via POST /api/admin/generate-character-portraits).
--
-- Guarded by name + the current (broken) image_url, so this is a no-op once
-- a real portrait has since been uploaded and image_url updated.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Repoint to working gallery image (9 characters) ────────────────────────

UPDATE characters SET image_url = '/images/characters/alexei-gallery-1.jpg'
WHERE name = 'Alexei' AND image_url = '/images/characters/alexei.jpg';

UPDATE characters SET image_url = '/images/characters/athra-gallery-1.jpg'
WHERE name = 'Athra' AND image_url = '/images/characters/athra.jpg';

UPDATE characters SET image_url = '/images/characters/elan-gallery-1.jpg'
WHERE name = 'Elan' AND image_url = '/images/characters/elan.jpg';

UPDATE characters SET image_url = '/images/characters/ghost-of-muru-gallery-1.jpg'
WHERE name = 'Ghost of Muru' AND image_url = '/images/characters/ghost-of-muru.jpg';

UPDATE characters SET image_url = '/images/characters/narcis-gallery-1.jpg'
WHERE name = 'Narcis' AND image_url = '/images/characters/narcis.jpg';

UPDATE characters SET image_url = '/images/characters/professor-emeka-gallery-1.jpg'
WHERE name = 'Professor Emeka' AND image_url = '/images/characters/professor-emeka.jpg';

UPDATE characters SET image_url = '/images/characters/rumi-gallery-1.jpg'
WHERE name = 'Rumi' AND image_url = '/images/characters/rumi.jpg';

UPDATE characters SET image_url = '/images/characters/sancea-gallery-1.jpg'
WHERE name = 'Sancea' AND image_url = '/images/characters/sancea.jpg';

UPDATE characters SET image_url = '/images/characters/takeshi-gallery-1.jpg'
WHERE name = 'Takeshi' AND image_url = '/images/characters/takeshi.jpg';

-- ── No replacement file exists — fall back to the shared placeholder ───────
-- (6 characters: Bianca, Chef Amara, Dr. Covenant, Haifa, Hannah, Yanefes)

UPDATE characters SET image_url = '/images/character-placeholder.png'
WHERE name = 'Bianca' AND image_url = '/images/characters/bianca.jpg';

UPDATE characters SET image_url = '/images/character-placeholder.png'
WHERE name = 'Chef Amara' AND image_url = '/images/characters/chef-amara.jpg';

UPDATE characters SET image_url = '/images/character-placeholder.png'
WHERE name = 'Dr. Covenant' AND image_url = '/images/characters/dr-covenant.jpg';

UPDATE characters SET image_url = '/images/character-placeholder.png'
WHERE name = 'Haifa' AND image_url = '/images/characters/haifa.jpg';

UPDATE characters SET image_url = '/images/character-placeholder.png'
WHERE name = 'Hannah' AND image_url = '/images/characters/hannah.jpg';

UPDATE characters SET image_url = '/images/character-placeholder.png'
WHERE name = 'Yanefes' AND image_url = '/images/characters/yanefes.jpg';

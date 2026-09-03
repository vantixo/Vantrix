-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill image_url for the original launch cast
--
-- These 15 characters were originally seeded by 20260701_seed_launch_
-- characters.sql without a commissioned portrait, so image_url was left
-- unset and defaulted to /images/character-placeholder.png (see
-- 20260624_character_image_url_default.sql). Unlike 20260714_seed_visual_
-- characters.sql (which INSERTs six brand-new rows with image_url already
-- set), these rows already exist, so this migration UPDATEs them by name
-- instead of inserting.
--
-- This migration only sets the image_url column — it does not touch any
-- other row data. Filenames follow the same /images/characters/<slug>.<ext>
-- convention as the visual-led cast; the files themselves are placeholders
-- (committed under public/images/characters/) pending real portraits being
-- uploaded directly to the repo.
--
-- Guarded by name + a check that the row still points at the shared
-- placeholder, so re-running this migration is a no-op once a real image
-- has been uploaded and image_url updated by hand or by the Fal.ai
-- portrait-generation pipeline (POST /api/admin/generate-character-portraits).
--
-- Source of truth: src/lib/characters/seeds.ts (image_url field on each of
-- the 15 seeds below). If you edit seeds.ts, keep this file in sync by hand
-- (no codegen script for this file currently exists in the repo).
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE characters SET image_url = '/images/characters/yanefes.jpg'
WHERE name = 'Yanefes' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/ghost-of-muru.jpg'
WHERE name = 'Ghost of Muru' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/elan.jpg'
WHERE name = 'Elan' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/sancea.jpg'
WHERE name = 'Sancea' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/athra.jpg'
WHERE name = 'Athra' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/dr-covenant.jpg'
WHERE name = 'Dr. Covenant' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/haifa.jpg'
WHERE name = 'Haifa' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/rumi.jpg'
WHERE name = 'Rumi' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/narcis.jpg'
WHERE name = 'Narcis' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/alexei.jpg'
WHERE name = 'Alexei' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/bianca.jpg'
WHERE name = 'Bianca' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/hannah.jpg'
WHERE name = 'Hannah' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/takeshi.jpg'
WHERE name = 'Takeshi' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/professor-emeka.jpg'
WHERE name = 'Professor Emeka' AND image_url = '/images/character-placeholder.png';

UPDATE characters SET image_url = '/images/characters/chef-amara.jpg'
WHERE name = 'Chef Amara' AND image_url = '/images/character-placeholder.png';

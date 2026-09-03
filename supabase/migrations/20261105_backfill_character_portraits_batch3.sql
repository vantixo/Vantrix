-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill real portraits for 15 characters that were on the shared
-- placeholder (see the "20/65 have real portraits, 45 don't" audit from
-- earlier this session). Matched by occupation/archetype/description to a
-- batch of newly supplied character art; see public/images/characters/ for
-- the new files. Professor Emeka gets a second shot as a gallery image.
--
-- NOT matched from this batch, left on placeholder — flagged for follow-up:
--   - a female-doctor/stethoscope shot: no character in the roster has a
--     clinical-doctor occupation (Haifa is a psychologist/therapist, not a
--     natural fit for a stethoscope), so it wasn't force-matched to anyone.
--   - a chef shot: Chef Amara already has a real portrait (chef-amara.jpg),
--     so this one was left unused rather than overwriting her existing art.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE characters SET image_url = '/images/characters/professor-emeka.jpg', gallery_image_urls = ARRAY['/images/characters/professor-emeka-gallery-1.jpg'] WHERE name = 'Professor Emeka' AND image_url = '/images/character-placeholder.png';
UPDATE characters SET image_url = '/images/characters/alexei.jpg' WHERE name = 'Alexei' AND image_url = '/images/character-placeholder.png';
UPDATE characters SET image_url = '/images/characters/seraphine-vale.jpg' WHERE name = 'Seraphine Vale' AND image_url = '/images/character-placeholder.png';
UPDATE characters SET image_url = '/images/characters/takeshi.jpg' WHERE name = 'Takeshi' AND image_url = '/images/character-placeholder.png';
UPDATE characters SET image_url = '/images/characters/haifa.jpg' WHERE name = 'Haifa' AND image_url = '/images/character-placeholder.png';
UPDATE characters SET image_url = '/images/characters/lev-adria.jpg' WHERE name = 'Lev Adria' AND image_url = '/images/character-placeholder.png';
UPDATE characters SET image_url = '/images/characters/mara-coldthorn.jpg' WHERE name = 'Mara Coldthorn' AND image_url = '/images/character-placeholder.png';
UPDATE characters SET image_url = '/images/characters/narcis.jpg' WHERE name = 'Narcis' AND image_url = '/images/character-placeholder.png';
UPDATE characters SET image_url = '/images/characters/dominik.jpg' WHERE name = 'Dominik' AND image_url = '/images/character-placeholder.png';
UPDATE characters SET image_url = '/images/characters/countess-vesper.jpg' WHERE name = 'Countess Vesper' AND image_url = '/images/character-placeholder.png';
UPDATE characters SET image_url = '/images/characters/hispania.jpg' WHERE name = 'Hispania' AND image_url = '/images/character-placeholder.png';
UPDATE characters SET image_url = '/images/characters/marianne.jpg' WHERE name = 'Marianne' AND image_url = '/images/character-placeholder.png';
UPDATE characters SET image_url = '/images/characters/seraphine.jpg' WHERE name = 'Seraphine' AND image_url = '/images/character-placeholder.png';
UPDATE characters SET image_url = '/images/characters/aurelian.jpg' WHERE name = 'Aurelian' AND image_url = '/images/character-placeholder.png';
UPDATE characters SET image_url = '/images/characters/iset-vare.jpg' WHERE name = 'Iset Vare' AND image_url = '/images/character-placeholder.png';

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill real portraits for 17 of the 23 characters still on the shared
-- placeholder after batch3/batch4 (20261105/20261106). Matched by
-- occupation/archetype/description/hair-eye-color to a newly supplied batch
-- of character art (11 realistic photos + 6 anime) — see
-- public/images/characters/ for the new files.
--
-- Confidence notes:
--   - All 6 anime matches and 9 of the 11 realistic matches have a direct,
--     literal visual anchor in the character's own data (an audio-forensics
--     specialist photographed at a reel-to-reel deck, a manuscript restorer
--     literally described as having "silver-streaked black" hair matching
--     the photo, a weather warden with "sky blue" hair posed inside a
--     rain/water swirl, etc.) — see each character's occupation/hair_color/
--     eye_color columns.
--   - Vesper Quinn (information broker, "Archive's lower market districts")
--     is the one lower-confidence match in this batch: she has no
--     hair_color/eye_color on file to confirm against, so this is a
--     thematic match only (night bazaar/market setting + a satchel of
--     papers, read as "trades in information"), not a trait match like the
--     other 16. Worth a human glance before treating it as final.
--
-- NOT matched from this batch, left on placeholder — same "don't
-- force-match" policy as batch3/batch4:
--   - Cassian Rune, Mira Glass, Morrow Ash, Nyx, Ora the Archive-Bound, The
--     Nameless One — all six have no hair_color/eye_color on file AND
--     archetypes with no concrete visual anchor (Nyx is specifically
--     "blonde/blue eyes" per her row, and nothing in this batch has blonde
--     hair, so she's excluded on a real mismatch rather than just missing
--     data). Left for a future batch or an explicit design pass on what
--     these should look like.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE characters SET image_url = '/images/characters/vesper-quinn.jpg' WHERE name = 'Vesper Quinn' AND image_url = '/images/character-placeholder.png';
UPDATE characters SET image_url = '/images/characters/calla-fendris.jpg' WHERE name = 'Calla Fendris' AND image_url = '/images/character-placeholder.png';
UPDATE characters SET image_url = '/images/characters/thessaly-vorne.jpg' WHERE name = 'Thessaly Vorne' AND image_url = '/images/character-placeholder.png';
UPDATE characters SET image_url = '/images/characters/vesna-olaris.jpg' WHERE name = 'Vesna Olaris' AND image_url = '/images/character-placeholder.png';
UPDATE characters SET image_url = '/images/characters/cassian-morrow.jpg' WHERE name = 'Cassian Morrow' AND image_url = '/images/character-placeholder.png';
UPDATE characters SET image_url = '/images/characters/declan-voss.jpg' WHERE name = 'Declan Voss' AND image_url = '/images/character-placeholder.png';
UPDATE characters SET image_url = '/images/characters/edric-hale.jpg' WHERE name = 'Edric Hale' AND image_url = '/images/character-placeholder.png';
UPDATE characters SET image_url = '/images/characters/riona-vaugh.jpg' WHERE name = 'Riona Vaugh' AND image_url = '/images/character-placeholder.png';
UPDATE characters SET image_url = '/images/characters/rael-ashmore.jpg' WHERE name = 'Rael Ashmore' AND image_url = '/images/character-placeholder.png';
UPDATE characters SET image_url = '/images/characters/soren-vaas.jpg' WHERE name = 'Soren Vaas' AND image_url = '/images/character-placeholder.png';
UPDATE characters SET image_url = '/images/characters/fenris-gale.jpg' WHERE name = 'Fenris Gale' AND image_url = '/images/character-placeholder.png';
UPDATE characters SET image_url = '/images/characters/kael-ashvane.jpg' WHERE name = 'Kael Ashvane' AND image_url = '/images/character-placeholder.png';
UPDATE characters SET image_url = '/images/characters/lumi-crestfall.jpg' WHERE name = 'Lumi Crestfall' AND image_url = '/images/character-placeholder.png';
UPDATE characters SET image_url = '/images/characters/ren-voidwalker.jpg' WHERE name = 'Ren Voidwalker' AND image_url = '/images/character-placeholder.png';
UPDATE characters SET image_url = '/images/characters/sable-ashmark.jpg' WHERE name = 'Sable Ashmark' AND image_url = '/images/character-placeholder.png';
UPDATE characters SET image_url = '/images/characters/yuki-seraph.jpg' WHERE name = 'Yuki Seraph' AND image_url = '/images/character-placeholder.png';
UPDATE characters SET image_url = '/images/characters/miyu-cloudweaver.jpg' WHERE name = 'Miyu Cloudweaver' AND image_url = '/images/character-placeholder.png';

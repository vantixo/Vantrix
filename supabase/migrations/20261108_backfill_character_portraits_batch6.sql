-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill real portraits for 5 of the 6 characters still on the shared
-- placeholder after batch5 (20261107) — the archive-of-echoes characters
-- that batch5 explicitly declined to force-match. Matched to a batch of
-- 5 newly supplied images, all with concrete visual anchors this time:
--
--   - Nyx: her row has explicit hair_color='blonde', eye_color='blue' —
--     batch5 flagged her as excluded on a real mismatch (nothing in that
--     batch was blonde). This batch's image is a blonde, blue-eyed woman
--     established as a "smuggler of forgotten things" via a bag of
--     trinkets in a back-alley — direct trait AND occupation match.
--   - Ora, the Archive-Bound: "Archive-construct... grown directly from
--     the Archive's core, not born" / "living index of everything the
--     Archive has forgotten." The supplied image is an explicitly
--     non-human, bald, sexless figure with binary code visible in its
--     eyes, in a library/archive setting — about as literal a match as
--     an "other"-gender construct-being gets.
--   - The Nameless One: "Names are cages. It has chosen to stay outside
--     every one offered to it" / has no description "this is the entire
--     point of what it is." The supplied image is a faceless silhouette
--     in a library, no identifying features at all — the visual
--     equivalent of the character's entire premise.
--   - Morrow Ash: "Human, burned by Archive fire... from the war-camps
--     beyond the Archive's eastern wall," reformed mercenary. The
--     supplied image is a battle-scarred warrior in scorched armor on a
--     burning battlefield.
--   - Mira Glass: "The Fragile Visionary... reality-touched... a crack in
--     the Archive's structure that shouldn't exist. Nothing holds still."
--     The supplied image is a visibly fragile young woman beside a
--     cracked/shattered mirror — her own name literally being "Glass."
--
-- Still NOT matched, left on placeholder: Cassian Rune (Translator of
-- dead languages, Obsessive Scholar) — no hair/eye data on file and
-- nothing in this batch depicts a scholar/translator specifically (the
-- two library-set images in this batch were both stronger, more specific
-- matches for Ora and The Nameless One instead). This is now the only
-- character left on the shared placeholder.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE characters SET image_url = '/images/characters/nyx.jpg' WHERE name = 'Nyx' AND image_url = '/images/character-placeholder.png';
UPDATE characters SET image_url = '/images/characters/ora-the-archive-bound.jpg' WHERE name = 'Ora, the Archive-Bound' AND image_url = '/images/character-placeholder.png';
UPDATE characters SET image_url = '/images/characters/the-nameless-one.jpg' WHERE name = 'The Nameless One' AND image_url = '/images/character-placeholder.png';
UPDATE characters SET image_url = '/images/characters/morrow-ash.jpg' WHERE name = 'Morrow Ash' AND image_url = '/images/character-placeholder.png';
UPDATE characters SET image_url = '/images/characters/mira-glass.jpg' WHERE name = 'Mira Glass' AND image_url = '/images/character-placeholder.png';

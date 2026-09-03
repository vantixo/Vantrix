-- GENDER-IMAGE-FIX: visual audit found 14 characters whose portrait did not
-- match their labeled gender (6 male-labeled characters carrying a female
-- portrait, 8 female-labeled characters carrying a male portrait) — almost
-- certainly image files getting shuffled between genders during a batch
-- upload. Rather than discard working art, the 6/8 that pair up are
-- swapped between their gender-correct counterparts; the 2 female rows
-- with no male counterpart to swap with fall back to the shared
-- placeholder (same pattern as 20260943_fix_broken_launch_character_images).

-- 1. Ivan Korrath (male) <-> Selene Dusk (female)
UPDATE characters SET image_url = '/images/characters/uploaded/selene-dusk.jpg'
WHERE id = '528d3015-50dd-441c-aed8-96e566e0fda2'; -- Ivan Korrath
UPDATE characters SET image_url = '/images/characters/uploaded/ivan-korrath.jpg'
WHERE id = 'd4138c58-92b7-4328-b4a8-21fbcf92caaf'; -- Selene Dusk

-- 2. Kael Ember (male) <-> Astra Nocturne (female)
UPDATE characters SET image_url = '/images/characters/uploaded/astra-nocturne.jpg'
WHERE id = 'fc0799bc-7b83-410e-beec-24a00c4c2e79'; -- Kael Ember
UPDATE characters SET image_url = '/images/characters/uploaded/kael-ember.jpg'
WHERE id = 'cb3aff66-04a8-443b-a5bb-9ac610ec7f04'; -- Astra Nocturne

-- 3. Aurelian (male) <-> Mira Glass (female)
UPDATE characters SET image_url = '/images/characters/uploaded/mira-glass.jpg'
WHERE id = 'f1b7877f-a5fb-4294-b124-d6299ac0818f'; -- Aurelian
UPDATE characters SET image_url = '/images/characters/uploaded/aurelian.jpg'
WHERE id = '02378d6a-371c-426e-ae2f-b23e3d68e79e'; -- Mira Glass

-- 4. Brother Corvin (male) <-> Solaris Venn (female)
UPDATE characters SET image_url = '/images/characters/uploaded/solaris-venn.jpg'
WHERE id = '189fbc6c-1521-4955-857c-e4a1aa3800f7'; -- Brother Corvin
UPDATE characters SET image_url = '/images/characters/uploaded/brother-corvin.jpg'
WHERE id = '47b4a177-d469-4004-aa69-606892bf88ab'; -- Solaris Venn

-- 5. Declan Voss (male) <-> Thessaly Vorne (female)
UPDATE characters SET image_url = '/images/characters/uploaded/thessaly-vorne.jpg'
WHERE id = 'ea700c95-7a64-4ebc-b46b-3ab45d258117'; -- Declan Voss
UPDATE characters SET image_url = '/images/characters/uploaded/declan-voss.jpg'
WHERE id = 'd30833ef-ba8f-41ac-8e6d-da773e2909de'; -- Thessaly Vorne

-- 6. Dr. Elias Voss (male) <-> Valeria Storm (female)
UPDATE characters SET image_url = '/images/characters/uploaded/valeria-storm.jpg'
WHERE id = 'd895317b-77d3-41c9-82c6-2b6e08ec6ec9'; -- Dr. Elias Voss
UPDATE characters SET image_url = '/images/characters/uploaded/dr-elias-voss.jpg'
WHERE id = '363af3eb-e87e-4735-b6d8-c1be716840cb'; -- Valeria Storm

-- 7-8. No male counterpart left to swap with — fall back to placeholder
-- rather than leave a wrong-gender portrait live.
UPDATE characters SET image_url = '/images/character-placeholder.png'
WHERE id = 'c9487a6b-9dda-4799-bb00-f6193ed22b4e'; -- Vesna Olaris
UPDATE characters SET image_url = '/images/character-placeholder.png'
WHERE id = 'b8078765-1c83-436a-bdd7-bb737fddbce9'; -- Vesper Quinn

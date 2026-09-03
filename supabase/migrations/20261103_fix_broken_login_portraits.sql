-- ─────────────────────────────────────────────────────────────────────────────
-- Fix broken /login portrait collage
--
-- ROOT CAUSE: 20261016_seed_login_portraits_config.sql seeded app_config
-- ('login_portraits') with four paths — countess-vesper-night.jpg,
-- seraphine-sultry.jpg, lord-adrian-gunslinger.jpg, hispania-valeria.jpg —
-- that were never actually placed under public/images/characters/. Every
-- signed-out visitor to /login has been getting four broken-image icons in
-- the portrait grid since that migration ran. src/lib/config/login-
-- portraits.ts's FALLBACK_LOGIN_PORTRAITS (used if this row is ever
-- missing/invalid) had the identical four broken paths hardcoded, so the
-- fallback path was equally broken — see the companion code fix in the
-- same commit that updates FALLBACK_LOGIN_PORTRAITS to match this row.
--
-- FIX: repoint all four slots at real, already-rendering portraits (each
-- one is that character's live `characters.image_url`, confirmed present
-- under public/images/characters/). Lord Adrian's slot keeps the same
-- character as originally intended (gunslinger variant never existed;
-- gallery-2 is his one real portrait). The other three characters
-- (Countess Vesper, Seraphine, Hispania) have no real art at all yet
-- (image_url = character-placeholder.png), so their slots are swapped for
-- three other characters who do.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE app_config
SET value = '[{"src":"/images/characters/lord-adrian-gallery-2.jpg","alt":""},{"src":"/images/characters/selene-dusk-gallery-1.jpg","alt":""},{"src":"/images/characters/valeria-storm-gallery-1.jpg","alt":""},{"src":"/images/characters/astra-nocturne-gallery-1.jpg","alt":""}]'
WHERE key = 'login_portraits'
  AND value = '[{"src":"/images/characters/countess-vesper-night.jpg","alt":""},{"src":"/images/characters/seraphine-sultry.jpg","alt":""},{"src":"/images/characters/lord-adrian-gunslinger.jpg","alt":""},{"src":"/images/characters/hispania-valeria.jpg","alt":""}]';

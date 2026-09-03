-- Seed Scenario Cover Images — Existing Dedicated Assets
--
-- first-date / late-night-talk / jealousy / at-the-beach already have real
-- art on disk (public/images/scenarios/<slug>.jpg — added alongside
-- 20261120_home_location_scenarios.sql per its own comment), but that
-- mapping only ever lived in a hardcoded DEDICATED_IMAGES lookup inside
-- popular-scenarios.tsx. Nowhere else knew about it: scenario-picker.tsx
-- (starting a roleplay), world-scenarios-section.tsx (World hub "Scenarios
-- Here"), and roleplay-stage.tsx's own backdrop all read
-- roleplay_scenarios.cover_image_url directly, found it NULL, and (before
-- SCENARIO_IMAGE_FALLBACK) rendered a character's portrait as the cover for
-- what should have been these 4 scenes' actual photography.
--
-- Setting cover_image_url here fixes all of those surfaces at once, using
-- assets that already exist — no new art needed for these 4. The
-- DEDICATED_IMAGES lookup in popular-scenarios.tsx is now redundant (its
-- value matches what's set here) but harmless to leave in place.
--
-- Idempotent — safe to re-run.

UPDATE roleplay_scenarios SET cover_image_url = '/images/scenarios/first-date.jpg'      WHERE slug = 'first-date';
UPDATE roleplay_scenarios SET cover_image_url = '/images/scenarios/late-night-talk.jpg' WHERE slug = 'late-night-talk';
UPDATE roleplay_scenarios SET cover_image_url = '/images/scenarios/jealousy.jpg'        WHERE slug = 'jealousy';
UPDATE roleplay_scenarios SET cover_image_url = '/images/scenarios/at-the-beach.jpg'    WHERE slug = 'at-the-beach';

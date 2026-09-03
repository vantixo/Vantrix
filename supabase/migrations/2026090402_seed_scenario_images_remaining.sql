-- Seed Scenario Cover Images — Remaining 24
--
-- Depends on roleplay_scenarios.cover_image_url (native column, no ALTER
-- needed — see 20261030_story_mode_scenario_system.sql) and follows
-- 20260903_seed_scenario_dedicated_images.sql (the first 4: first-date,
-- late-night-talk, jealousy, at-the-beach). This covers every remaining
-- scenario from the prompt sheet — all 28 rows in roleplay_scenarios now
-- have real art. SCENARIO_IMAGE_FALLBACK becomes a true fallback (new
-- scenarios only) instead of the default state, same milestone World hit
-- after its 3 batches.
--
-- Same local /public path pattern and resize-to-1000px + JPEG q72
-- compression pass as every other image batch.
--
-- Idempotent — safe to re-run.

UPDATE roleplay_scenarios SET cover_image_url = '/images/scenarios/the-heist.jpg'                      WHERE slug = 'the-heist';
UPDATE roleplay_scenarios SET cover_image_url = '/images/scenarios/letters-from-the-front.jpg'         WHERE slug = 'letters-from-the-front';
UPDATE roleplay_scenarios SET cover_image_url = '/images/scenarios/the-last-bookstore-on-elm-street.jpg' WHERE slug = 'the-last-bookstore-on-elm-street';
UPDATE roleplay_scenarios SET cover_image_url = '/images/scenarios/midnight-precinct.jpg'              WHERE slug = 'midnight-precinct';
UPDATE roleplay_scenarios SET cover_image_url = '/images/scenarios/the-academy-of-hidden-things.jpg'   WHERE slug = 'the-academy-of-hidden-things';
UPDATE roleplay_scenarios SET cover_image_url = '/images/scenarios/shipwrecked.jpg'                    WHERE slug = 'shipwrecked';
UPDATE roleplay_scenarios SET cover_image_url = '/images/scenarios/the-understudy.jpg'                 WHERE slug = 'the-understudy';
UPDATE roleplay_scenarios SET cover_image_url = '/images/scenarios/six-months-on-mars.jpg'             WHERE slug = 'six-months-on-mars';
UPDATE roleplay_scenarios SET cover_image_url = '/images/scenarios/the-arranged-engagement.jpg'        WHERE slug = 'the-arranged-engagement';
UPDATE roleplay_scenarios SET cover_image_url = '/images/scenarios/neon-district.jpg'                  WHERE slug = 'neon-district';
UPDATE roleplay_scenarios SET cover_image_url = '/images/scenarios/the-reunion.jpg'                    WHERE slug = 'the-reunion';
UPDATE roleplay_scenarios SET cover_image_url = '/images/scenarios/werewolves-of-ashford.jpg'          WHERE slug = 'werewolves-of-ashford';
UPDATE roleplay_scenarios SET cover_image_url = '/images/scenarios/the-apology.jpg'                    WHERE slug = 'the-apology';
UPDATE roleplay_scenarios SET cover_image_url = '/images/scenarios/long-distance-reunion.jpg'          WHERE slug = 'long-distance-reunion';
UPDATE roleplay_scenarios SET cover_image_url = '/images/scenarios/meeting-the-family.jpg'             WHERE slug = 'meeting-the-family';
UPDATE roleplay_scenarios SET cover_image_url = '/images/scenarios/the-confession.jpg'                 WHERE slug = 'the-confession';
UPDATE roleplay_scenarios SET cover_image_url = '/images/scenarios/undercroft-after-hours.jpg'         WHERE slug = 'undercroft-after-hours';
UPDATE roleplay_scenarios SET cover_image_url = '/images/scenarios/cloudspire-rooftop-launch.jpg'      WHERE slug = 'cloudspire-rooftop-launch';
UPDATE roleplay_scenarios SET cover_image_url = '/images/scenarios/protocol-all-nighter.jpg'           WHERE slug = 'protocol-all-nighter';
UPDATE roleplay_scenarios SET cover_image_url = '/images/scenarios/unseen-invitation.jpg'              WHERE slug = 'unseen-invitation';
UPDATE roleplay_scenarios SET cover_image_url = '/images/scenarios/council-after-hours.jpg'            WHERE slug = 'council-after-hours';
UPDATE roleplay_scenarios SET cover_image_url = '/images/scenarios/held-together.jpg'                  WHERE slug = 'held-together';
UPDATE roleplay_scenarios SET cover_image_url = '/images/scenarios/old-families-masquerade.jpg'        WHERE slug = 'old-families-masquerade';
UPDATE roleplay_scenarios SET cover_image_url = '/images/scenarios/closing-time-archive.jpg'           WHERE slug = 'closing-time-archive';

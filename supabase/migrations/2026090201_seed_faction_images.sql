-- Seed Faction Images — Completes World Hub Art
--
-- Depends on 20260827_world_location_faction_images.sql (adds image_url
-- to both world_locations AND factions). Targets the `factions` table,
-- not world_locations — these 5 rows are the entire factions table (see
-- INSERT INTO factions in 20240200_world_expansion.sql), so this is also
-- the last remaining gap: every world_locations row already has art as of
-- 20260901_seed_world_location_images_batch3.sql except
-- wing-of-hidden-names, and now every factions row has art too.
--
-- Same local /public path pattern as the location seed migrations, same
-- resize-to-1000px-long-edge + JPEG q72 compression pass.
--
-- Idempotent — safe to re-run.

UPDATE factions SET image_url = '/images/world/council-of-seven.jpg' WHERE slug = 'council-of-seven';
UPDATE factions SET image_url = '/images/world/iron-compact.jpg'     WHERE slug = 'iron-compact';
UPDATE factions SET image_url = '/images/world/the-protocol.jpg'     WHERE slug = 'the-protocol';
UPDATE factions SET image_url = '/images/world/old-families.jpg'     WHERE slug = 'old-families';
UPDATE factions SET image_url = '/images/world/the-unseen.jpg'       WHERE slug = 'the-unseen';

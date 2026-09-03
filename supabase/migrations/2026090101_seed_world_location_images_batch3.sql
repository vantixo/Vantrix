-- Seed World Location Images — Third Batch (Archive Wings)
--
-- Depends on 20260827_world_location_faction_images.sql (image_url column)
-- and follows the first two seed batches (20260830, 20260831). Same local
-- /public path pattern as those.
--
-- This batch covers all 9 uploaded images 1:1 — no leftovers this time.
-- After this migration, every Archive Wing has art except
-- wing-of-hidden-names, which is the only location left without a
-- generated image at all (still on WORLD_IMAGE_FALLBACK). See the
-- location prompt sheet for its prompt when art gets generated for it.
--
-- Idempotent — safe to re-run.

UPDATE world_locations SET image_url = '/images/world/wing-of-the-fallen-stair.jpg' WHERE slug = 'wing-of-the-fallen-stair';
UPDATE world_locations SET image_url = '/images/world/wing-of-the-crack.jpg'        WHERE slug = 'wing-of-the-crack';
UPDATE world_locations SET image_url = '/images/world/wing-of-the-crossroads.jpg'   WHERE slug = 'wing-of-the-crossroads';
UPDATE world_locations SET image_url = '/images/world/wing-of-between-light.jpg'    WHERE slug = 'wing-of-between-light';
UPDATE world_locations SET image_url = '/images/world/wing-of-the-storm-wall.jpg'   WHERE slug = 'wing-of-the-storm-wall';
UPDATE world_locations SET image_url = '/images/world/wing-of-the-long-market.jpg'  WHERE slug = 'wing-of-the-long-market';
UPDATE world_locations SET image_url = '/images/world/the-ashen-cloister.jpg'       WHERE slug = 'the-ashen-cloister';
UPDATE world_locations SET image_url = '/images/world/the-fourth-wall-wing.jpg'     WHERE slug = 'the-fourth-wall-wing';
UPDATE world_locations SET image_url = '/images/world/the-research-wing.jpg'        WHERE slug = 'the-research-wing';

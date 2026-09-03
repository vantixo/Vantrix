-- Seed World Location Images — First Batch
--
-- Depends on 20260827_world_location_faction_images.sql (adds the
-- image_url column this seeds). Sets image_url for the 8 core locations
-- art has been generated for so far, using the local /public paths copied
-- in alongside this migration (public/images/world/<slug>.jpg) rather than
-- an external CDN — same "site-relative asset path" pattern already used
-- for character-placeholder.png / the promo images (see isSafeLocalImagePath
-- in lib/security.ts, which both api/admin/route.ts schemas and this data
-- rely on staying permissive for /images/**).
--
-- The remaining locations/factions keep rendering WORLD_IMAGE_FALLBACK
-- until their own art is generated and added the same way (via /admin/world,
-- or a follow-up migration like this one).
--
-- Idempotent — safe to re-run.

UPDATE world_locations SET image_url = '/images/world/the-capital.jpg'      WHERE slug = 'the-capital';
UPDATE world_locations SET image_url = '/images/world/iron-reach.jpg'       WHERE slug = 'iron-reach';
UPDATE world_locations SET image_url = '/images/world/the-undercroft.jpg'   WHERE slug = 'the-undercroft';
UPDATE world_locations SET image_url = '/images/world/cloudspire.jpg'       WHERE slug = 'cloudspire';
UPDATE world_locations SET image_url = '/images/world/the-archive.jpg'      WHERE slug = 'the-archive';
UPDATE world_locations SET image_url = '/images/world/obsidian-tower.jpg'   WHERE slug = 'obsidian-tower';
UPDATE world_locations SET image_url = '/images/world/the-ruins.jpg'        WHERE slug = 'the-ruins';
UPDATE world_locations SET image_url = '/images/world/wing-of-the-root.jpg' WHERE slug = 'wing-of-the-root';

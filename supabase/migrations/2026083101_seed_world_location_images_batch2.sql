-- Seed World Location Images — Second Batch (Archive Wings)
--
-- Depends on 20260827_world_location_faction_images.sql (image_url column)
-- and follows 20260830_seed_world_location_images.sql (first batch of 8
-- core locations). Same local /public path pattern as that migration.
--
-- Only 3 of this batch's 4 generated images are used here. The 4th (a
-- portrait-format decorative card — ornate gold frame, crown, and the
-- caption "DROWNED, YET STILL IT RINGS" baked into the image) isn't wired
-- to any location: it's a lovely piece, but the World hub's house style
-- is explicitly no-text/no-frame (see the shared style block in the
-- location prompt sheet), and embedded text can't be localized or resized
-- like the rest of the UI. wing-of-the-drowned-court already has a proper
-- textless establishing shot in this same batch, so that one's covered —
-- the card is left out of image_url entirely rather than misused as a
-- banner. It's still in /mnt/user-data/uploads if you want it for
-- something else (a loading screen, a card-collection feature, etc.).
--
-- Idempotent — safe to re-run.

UPDATE world_locations SET image_url = '/images/world/wing-of-the-ash-camps.jpg'      WHERE slug = 'wing-of-the-ash-camps';
UPDATE world_locations SET image_url = '/images/world/wing-of-the-long-sky.jpg'       WHERE slug = 'wing-of-the-long-sky';
UPDATE world_locations SET image_url = '/images/world/wing-of-the-drowned-court.jpg'  WHERE slug = 'wing-of-the-drowned-court';

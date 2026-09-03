-- 3D character pipeline: per-character model asset.
--
-- Everything characters have today (image_url, avatar_url, gallery_*,
-- intro_video_url) is 2D. This adds the one column the new
-- src/components/immersive/character-3d.tsx viewer needs: a URL to a
-- .glb/.gltf asset. Nullable, no default — no character has a 3D model
-- yet, and character-portrait.tsx (the shared entry point) falls back to
-- the existing 2D LivingPortrait whenever this is null, so every
-- existing character keeps rendering exactly as before until a model is
-- actually uploaded for it.
ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS model_url TEXT;

COMMENT ON COLUMN characters.model_url IS
  '.glb/.gltf asset for the 3D portrait viewer (character-3d.tsx). NULL means no 3D model yet — character-portrait.tsx falls back to the 2D image (image_url) LivingPortrait in that case. Expected to carry at least one animation clip named "Idle" (falls back to its first clip if not found — see character-3d.tsx).';

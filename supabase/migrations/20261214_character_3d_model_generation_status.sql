-- 3D character model generation lifecycle, mirroring the existing
-- video_status pattern from 20260715_character_animated_portrait.sql.
--
-- model_url already exists (20261213_character_model_url.sql) but has no
-- accompanying lifecycle columns — there was no way to distinguish "never
-- attempted" from "generation in flight" from "generation failed", and no
-- fal_request_id for the webhook (lib/fal/character-3d-model.ts,
-- api/webhooks/fal-3d-model) to correlate a completion callback back to
-- the right character.
--
-- Deliberately NOT required at insert time and NOT blocking anything else
-- — this is additive. A character with model_status = 'none' (the
-- default, matching every existing row) renders identically to today via
-- character-portrait-viewer.tsx's procedural-avatar/2D fallback tiers.

ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS model_status          text NOT NULL DEFAULT 'none'
    CHECK (model_status IN ('none', 'processing', 'completed', 'failed')),
  ADD COLUMN IF NOT EXISTS model_fal_request_id  text,
  ADD COLUMN IF NOT EXISTS model_error           text,
  ADD COLUMN IF NOT EXISTS model_generated_at    timestamptz;

CREATE INDEX IF NOT EXISTS idx_characters_model_status
  ON characters (model_status)
  WHERE model_status IN ('none', 'processing');

COMMENT ON COLUMN characters.model_status IS
  'none: never attempted (default — matches every pre-existing row). processing: fal.ai image-to-3D job in flight. completed: model_url is ready. failed: see model_error, frontend uses the procedural avatar/2D fallback tiers (character-portrait-viewer.tsx).';
COMMENT ON COLUMN characters.model_fal_request_id IS
  'fal.ai request id for the in-flight image-to-3D job, so api/webhooks/fal-3d-model can correlate its completion callback back to this character.';
COMMENT ON COLUMN characters.model_error IS
  'Last generation failure reason, if model_status = failed. Null otherwise.';
COMMENT ON COLUMN characters.model_generated_at IS
  'When model_url was last successfully (re)generated. Null until the first successful generation.';

-- Canon image set — permanent storage + status tracking
-- ─────────────────────────────────────────────────────────────────────────
-- lib/fal/lora-pipeline.ts's generateCanonImageSet() builds a 50-image
-- visual-identity library (angles/expressions/lighting/mood) for a
-- character once its LoRA finishes training, but had no destination column
-- and no caller — see discovery/production audit, 2026-07-23. Wiring it up
-- (webhooks/fal-lora/route.ts, after successful training) needs somewhere
-- to persist the result and somewhere for the admin UI to poll progress,
-- since 50 generations + R2 uploads run well past a typical request/response
-- cycle even inside a background after() callback.
--
-- Deliberately its own array, NOT gallery_image_urls: that column is the
-- character's *training reference set* (see train-lora/route.ts, which
-- reads gallery_image_urls as LoRA input) — writing canon-set output back
-- into it would mean the next retrain trains on the model's own prior
-- output, a feedback loop that visibly degrades identity fidelity over
-- generations. Also distinct from canon_sheet_url (singular — the one
-- reference still Kling's image-to-video pipeline uses), which stays
-- untouched by this.
--
-- Status column exists because this is a long-running background job with
-- real failure modes (Fal down, R2 down, <80% success threshold) that the
-- admin UI needs to reflect rather than silently showing an empty array
-- indistinguishable from "never ran."

ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS canon_image_urls      text[]       DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS canon_set_status       text         NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS canon_set_error        text         DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS canon_set_generated_at timestamptz  DEFAULT NULL;

ALTER TABLE characters
  ADD CONSTRAINT characters_canon_set_status_check
  CHECK (canon_set_status IN ('not_started', 'generating', 'complete', 'failed'));

COMMENT ON COLUMN characters.canon_image_urls IS
  'Permanent R2 URLs for the 50-image canon set (generateCanonImageSet). Populated once, after LoRA training completes.';
COMMENT ON COLUMN characters.canon_set_status IS
  'not_started | generating | failed | complete — lets the admin UI show progress on a job that runs past a single request lifecycle.';

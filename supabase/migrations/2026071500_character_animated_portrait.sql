-- Living-portrait animation support for character images.
--
-- video_url:            public R2 URL of the looping animation clip (subtle
--                        blink/breathe motion), null until generated.
-- video_status:         lifecycle of the animation job, independent of the
--                        underlying image — a character can be fully usable
--                        with just a static image while its video is still
--                        'pending'/'processing', or if it 'failed' (frontend
--                        falls back to the static image_url in all cases).
-- video_fal_request_id: fal.ai request id for the animation job, so the
--                        webhook can correlate a completion callback back to
--                        the right character without re-querying by URL.
--
-- Deliberately NOT required at insert time and NOT blocking anything else —
-- this is additive. A character with video_status = 'pending' or no row at
-- all renders identically to today (static image), by design.

ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS video_url            text,
  ADD COLUMN IF NOT EXISTS video_status          text NOT NULL DEFAULT 'pending'
    CHECK (video_status IN ('pending', 'processing', 'completed', 'failed')),
  ADD COLUMN IF NOT EXISTS video_fal_request_id  text,
  ADD COLUMN IF NOT EXISTS video_error           text,
  ADD COLUMN IF NOT EXISTS video_generated_at    timestamptz;

CREATE INDEX IF NOT EXISTS idx_characters_video_status
  ON characters (video_status)
  WHERE video_status IN ('pending', 'processing');

COMMENT ON COLUMN characters.video_url IS
  'Public R2 URL of the looping living-portrait animation. NULL = fall back to image_url (static) on the frontend.';
COMMENT ON COLUMN characters.video_status IS
  'pending: not yet requested. processing: fal.ai job in flight. completed: video_url is ready. failed: see video_error, frontend uses image_url.';

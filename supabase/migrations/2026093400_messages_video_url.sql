-- In-chat video generation (see src/lib/video/video-router.ts) never had a
-- column to persist its result to — messages only had image_url, so a
-- generated video only ever lived in the requesting client's React state
-- and vanished on refresh/reload or when scrolled out of view. This mirrors
-- the existing image_url column so the message-insert fix in
-- /api/chat/video/status/route.ts has somewhere to write.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS video_url TEXT;

-- Phase B audit fix (2026-08-06): dating/compatibility/route.ts's own header
-- comment documented a "BUG-5 FIX" for a recompute-throttle bug, but the fix
-- left conversation_count >= RECOMPUTE_CONVOS as an unconditional OR against
-- an absolute (never-reset) count with no stored baseline — the code's own
-- comment admitted "conversation_count at last persist is not stored per-row
-- (schema gap)". In practice this meant once a match passed 10 total
-- conversations, that condition became permanently true, and the 24h/
-- 10-conversation throttle silently stopped applying: every GET request
-- triggered a full recompute (2 extra queries) and a DB write, forever.
--
-- This column stores conversation_count AT THE TIME of the last compatibility
-- recompute, so the route can check a true delta (current count minus this
-- baseline) instead of an absolute count.
ALTER TABLE dating_matches
  ADD COLUMN IF NOT EXISTS compatibility_update_convo_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN dating_matches.compatibility_update_convo_count IS
  'conversation_count value at the time of the last compatibility_score recompute — lets dating/compatibility/route.ts gate on conversations-since-last-update rather than an absolute, never-reset count.';

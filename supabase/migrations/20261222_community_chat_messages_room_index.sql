-- Character Room feature: community_chat_messages was already in the
-- schema (created before this feature existed, never wired to any code
-- until now — see src/lib/community/character-room.ts) but had no index
-- beyond its primary key. Every room read is
--   WHERE community_slug = ? ORDER BY created_at DESC LIMIT ?
-- which without this index is a full-table scan re-sorted per request —
-- fine at zero rows, a real cost once any room has meaningful history and
-- this is being polled every 3s per open room by every viewer.
CREATE INDEX IF NOT EXISTS community_chat_messages_slug_created_at_idx
  ON community_chat_messages (community_slug, created_at DESC);

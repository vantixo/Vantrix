-- ============================================================================
-- Migration: 20260821_community_moderation.sql
-- Adds community-content reporting + a companion decrement RPC for reply
-- deletion (mirrors increment_community_reply_count from 20241000_community.sql).
-- ============================================================================

-- ── user_reports: community fields ──────────────────────────────────────────
-- /api/report (20240101_production.sql) only accepted conversationId /
-- characterId / matchId — there was no way to attach a report to a
-- community post or reply. Both columns are nullable and independent of
-- the existing ones so a single report row still only ever targets one
-- kind of content (enforced app-side in the route, same as today).

ALTER TABLE user_reports
  ADD COLUMN IF NOT EXISTS community_post_id  UUID REFERENCES community_posts(id)   ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS community_reply_id UUID REFERENCES community_replies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_user_reports_community_post
  ON user_reports(community_post_id) WHERE community_post_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_reports_community_reply
  ON user_reports(community_reply_id) WHERE community_reply_id IS NOT NULL;

-- ── RPC: decrement reply count atomically ───────────────────────────────────
-- Companion to increment_community_reply_count. Needed now that replies can
-- be deleted (DELETE /api/community/replies/[id]) — without this, deleting
-- a reply would either leave reply_count stale or require a racy
-- read-then-write in application code, the exact bug class the like-toggle
-- RPC (20241200_community_like_toggle_rpc.sql) already fixed once for likes.
-- Clamped at 0 defensively; should never go negative in practice since a
-- reply row can only be deleted once.

CREATE OR REPLACE FUNCTION decrement_community_reply_count(p_post_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE community_posts
  SET    reply_count = GREATEST(reply_count - 1, 0),
         updated_at  = now()
  WHERE  id = p_post_id;
END;
$$;

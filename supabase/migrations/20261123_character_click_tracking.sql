-- Vantrix — character click tracking (real "trending" signal)
-- Migration: 20261123_character_click_tracking.sql
--
-- Trending previously meant "sort the already-fetched pool by like_count"
-- (explore-characters.tsx) — a static, all-time proxy with no connection
-- to what visitors are actually clicking into right now. This adds the
-- missing signal:
--
--   1. character_click_events — one row per profile-card click (fired by
--      CompanionCard via POST /api/characters/click on every surface that
--      reuses that card: Home's Explore/Featured rows, /characters browse,
--      dating candidate suggestions, etc.)
--   2. characters.profile_click_count — cheap all-time counter, same role
--      like_count/follower_count already play, kept in sync by the same
--      RPC that logs the event.
--   3. record_character_click(uuid) — SECURITY DEFINER insert+increment,
--      granted to anon+authenticated (discovery is a public, logged-out-
--      friendly surface — see discover/page.tsx's own "public acquisition
--      funnel" note). Mirrors increment_ad_stat()'s shape exactly.
--   4. trending_character_ids(hours, limit) — counts clicks in a rolling
--      window in SQL (same "count in the DB, don't pull rows into the
--      app" pattern as chat_affinity_tags(), 20260914 migration) so
--      lib/recommendations/trending.ts never has to scan the event table
--      from the app.
--
-- Both new functions are created after 20261121_security_definer_
-- privilege_lockdown.sql's `ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE
-- ... FROM PUBLIC`, so — like increment_ad_stat() — each needs its own
-- explicit grant below; without it neither is callable at all.

-- ── 1. Event log ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS character_click_events (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_character_click_events_char_created
  ON character_click_events (character_id, created_at DESC);

-- Window-scan index for trending_character_ids()'s `created_at > now() - N hours`.
CREATE INDEX IF NOT EXISTS idx_character_click_events_created
  ON character_click_events (created_at);

-- RLS on, no policies — every read/write goes through the two SECURITY
-- DEFINER functions below, same "no direct table access" posture as the
-- other event/ledger tables in this schema.
ALTER TABLE character_click_events ENABLE ROW LEVEL SECURITY;

-- ── 2. All-time counter on characters ───────────────────────────────────

ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS profile_click_count INTEGER NOT NULL DEFAULT 0;

-- ── 3. Record a click ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION record_character_click(p_character_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO character_click_events (character_id) VALUES (p_character_id);
  UPDATE characters SET profile_click_count = profile_click_count + 1 WHERE id = p_character_id;

  -- Opportunistic cleanup instead of a dedicated cron job (see
  -- CRON_TIERS.md — every extra cron job is another line in
  -- config/cron-jobs.mjs and another slot against Hobby's schedule cap):
  -- ~1 in 500 calls prunes events past the trending window's useful life.
  -- trending_character_ids() only ever looks back a few days at most, so
  -- nothing reads rows this old.
  IF random() < 0.002 THEN
    DELETE FROM character_click_events WHERE created_at < now() - INTERVAL '7 days';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION record_character_click(UUID) TO anon, authenticated;

-- ── 4. Rolling click-rank ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION trending_character_ids(p_hours INTEGER DEFAULT 48, p_limit INTEGER DEFAULT 60)
RETURNS TABLE(character_id UUID, click_count BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT character_id, COUNT(*) AS click_count
  FROM character_click_events
  WHERE created_at > now() - (GREATEST(p_hours, 1) || ' hours')::interval
  GROUP BY character_id
  ORDER BY click_count DESC
  LIMIT GREATEST(p_limit, 1);
$$;

GRANT EXECUTE ON FUNCTION trending_character_ids(INTEGER, INTEGER) TO anon, authenticated;

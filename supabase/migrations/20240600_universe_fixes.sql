-- ════════════════════════════════════════════════════════════════════════════
-- Universe / Legacy Systems fixes
--
-- Found during the Supabase migration audit (see 20240400_legacy_systems.sql):
--
--   1. get_character_biography() referenced two tables that are not created
--      anywhere in the schema — `career_events` and `event_character_reactions`
--      — and a `narrative` column on `companion_offline_log` that doesn't
--      exist (the real column is `content`). Calling this function would
--      fail with "relation does not exist" the first time it ran.
--
--   2. world_history.ts calls an RPC named `record_universe_memory` that was
--      never defined as a SQL function anywhere.
--
--   3. The cron registration at the end of 20240400_legacy_systems.sql
--      scheduled a pg_cron job that calls `enqueue_universe_job`, a function
--      that does not exist. This duplicated — and conflicted with — the
--      already-working Vercel Cron → /api/cron/legacy-tick → enqueueJob()
--      path. It would have failed silently every 6 hours if pg_cron was
--      enabled. This migration removes the dead schedule.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. New columns on universe_memory ────────────────────────────────────────
-- Needed so record_universe_memory() can store who was involved in a memory
-- and whether it's flagged as legendary, and so get_character_biography()
-- can look up "events I was personally part of" without a join table that
-- never existed.

ALTER TABLE universe_memory ADD COLUMN IF NOT EXISTS participants UUID[] NOT NULL DEFAULT '{}'::uuid[];
ALTER TABLE universe_memory ADD COLUMN IF NOT EXISTS is_legendary BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_universe_memory_participants ON universe_memory USING GIN (participants);

-- ── 2. record_universe_memory() ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION record_universe_memory(
  p_type        TEXT,
  p_title       TEXT,
  p_description TEXT,
  p_participants UUID[] DEFAULT '{}',
  p_location_id  UUID DEFAULT NULL,
  p_weight       INTEGER DEFAULT 50,
  p_legendary    BOOLEAN DEFAULT FALSE
)
RETURNS UUID AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO universe_memory (memory_type, title, description, location_id, emotional_weight, participants, is_legendary)
  VALUES (p_type, p_title, p_description, p_location_id, p_weight, COALESCE(p_participants, '{}'), COALESCE(p_legendary, FALSE))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 3. get_character_biography() — corrected ────────────────────────────────
-- Drops the 'career' branch (no such table exists in this schema; companion
-- career changes are already captured as 'life' entries via the offline
-- log), fixes the offline-log column name, and replaces the nonexistent
-- event_character_reactions join with a lookup against universe_memory's
-- new `participants` column.

CREATE OR REPLACE FUNCTION get_character_biography(p_character_id UUID, p_limit INTEGER DEFAULT 40)
RETURNS TABLE (
  source        TEXT,
  description   TEXT,
  occurred_at   TIMESTAMPTZ
) AS $$
  SELECT 'life', content, occurred_at FROM companion_offline_log WHERE character_id = p_character_id

  UNION ALL

  SELECT 'event', title || ' — ' || description, occurred_at
  FROM universe_memory
  WHERE p_character_id = ANY(participants)

  ORDER BY occurred_at DESC
  LIMIT p_limit;
$$ LANGUAGE sql STABLE;

-- ── 4. Remove the dead pg_cron registration ──────────────────────────────────
-- The real legacy-tick path is Vercel Cron -> /api/cron/legacy-tick ->
-- enqueueJob() (app-level, writes to universe_jobs) -> /api/workers/run.
-- That route already has heartbeat monitoring wired up. The pg_cron entry
-- below called a function that never existed, so it's removed rather than
-- fixed in place.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'legacy-tick') THEN
      PERFORM cron.unschedule('legacy-tick');
    END IF;
  END IF;
END $$;

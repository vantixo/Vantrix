-- ═══════════════════════════════════════════════════════════════════════
-- P0/P1 fix (audit items #4, #5): account deletion previously used
-- Promise.allSettled(), logged failures, and proceeded to delete the auth
-- user and report success regardless — "some data deleted, some remains,
-- auth account gone, API says success".
--
-- Fix has two parts:
--   1. deletion_requests — a durable, queryable record of deletion state
--      (requested -> processing -> completed | failed) that survives even
--      after the user's own rows are gone (no FK to profiles/auth.users).
--   2. verify_user_data_purged(uuid) — a GENERIC verification function.
--      Rather than a hand-maintained list of "tables we think matter"
--      (which drifts stale — this schema already has 90+ tables), it
--      introspects information_schema for every public-schema table with
--      a `user_id` column and returns any table where rows still exist
--      for the given user. The route treats a non-empty result as a hard
--      failure, not a warning.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS deletion_requests (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Intentionally NOT a foreign key to profiles/auth.users — this row
  -- must remain queryable after the user row itself is gone.
  user_id           UUID        NOT NULL,
  email             TEXT,
  status            TEXT        NOT NULL DEFAULT 'requested'
                                 CHECK (status IN ('requested', 'processing', 'completed', 'failed')),
  requested_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processing_at     TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  failed_at         TIMESTAMPTZ,
  -- What remained un-purged at last verification attempt, e.g.
  -- [{"table_name": "memory_graph", "remaining_count": 3}]
  remaining_tables  JSONB,
  redis_keys_deleted INTEGER,
  -- Redis DLQ payloads can retain user-identifying data until natural TTL
  -- expiry (audit item #6) — this is a documented, accepted interim state,
  -- not silently swept under "completed".
  redis_fully_clean BOOLEAN     NOT NULL DEFAULT FALSE,
  error_detail      TEXT,
  attempt_count     INTEGER     NOT NULL DEFAULT 0,
  created_by_ip     TEXT
);

CREATE INDEX IF NOT EXISTS idx_deletion_requests_user   ON deletion_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_deletion_requests_status ON deletion_requests(status) WHERE status IN ('requested', 'processing', 'failed');

ALTER TABLE deletion_requests ENABLE ROW LEVEL SECURITY;
-- No client access whatsoever — this is an internal operational record,
-- surfaced to the user only through the delete API's own response, and to
-- admins through the admin console (service_role only).
DROP POLICY IF EXISTS "deletion_requests_service_only" ON deletion_requests;
CREATE POLICY "deletion_requests_service_only" ON deletion_requests FOR ALL TO service_role USING (TRUE);
REVOKE ALL ON deletion_requests FROM authenticated, anon, PUBLIC;

-- ── Generic purge verification ───────────────────────────────────────────
-- Introspects every public-schema base table with a `user_id` uuid column
-- and returns the ones that still have rows for p_user_id. An empty result
-- set means "verified clean" across the entire known schema, automatically,
-- with no hand-maintained table list to keep in sync.
CREATE OR REPLACE FUNCTION verify_user_data_purged(p_user_id UUID)
RETURNS TABLE(table_name TEXT, remaining_count BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r RECORD;
  v_count BIGINT;
BEGIN
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'user_id'
      AND c.data_type = 'uuid'
      AND t.table_type = 'BASE TABLE'
      -- deletion_requests itself intentionally retains user_id as a
      -- permanent audit record — excluded from "still has my data" checks.
      AND c.table_name <> 'deletion_requests'
  LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE user_id = $1', r.table_name)
      INTO v_count
      USING p_user_id;

    IF v_count > 0 THEN
      table_name      := r.table_name;
      remaining_count := v_count;
      RETURN NEXT;
    END IF;
  END LOOP;

  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION verify_user_data_purged(UUID) TO service_role;

-- ── Best-effort remediation sweep ────────────────────────────────────────
-- Given the list of tables verify_user_data_purged() flagged, attempt a
-- direct DELETE against each (covers rows that survived because a FK to
-- auth.users/profiles was missing, SET NULL instead of CASCADE, etc).
-- Returns the same shape so the caller can re-verify afterward.
CREATE OR REPLACE FUNCTION purge_user_data_remediate(p_user_id UUID)
RETURNS TABLE(table_name TEXT, deleted_count BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r RECORD;
  v_count BIGINT;
BEGIN
  FOR r IN SELECT vp.table_name FROM verify_user_data_purged(p_user_id) vp
  LOOP
    BEGIN
      EXECUTE format('DELETE FROM %I WHERE user_id = $1', r.table_name)
        USING p_user_id;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      table_name    := r.table_name;
      deleted_count := v_count;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      -- A table that fails to delete (e.g. blocked by a downstream FK
      -- without CASCADE) is surfaced back to the caller as 0 deleted,
      -- so the subsequent re-verification still reports it as remaining
      -- rather than swallowing the error.
      table_name    := r.table_name;
      deleted_count := 0;
      RETURN NEXT;
    END;
  END LOOP;
  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION purge_user_data_remediate(UUID) TO service_role;

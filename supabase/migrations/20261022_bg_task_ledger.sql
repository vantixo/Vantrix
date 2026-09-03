-- Background task ledger.
--
-- The queue worker's W3 post-job enrichment block (psychology, XP, memory,
-- fact extraction, etc.) runs ~14 fire-and-forget async calls per message,
-- each guarded by `.catch(bg('label'))` (see src/lib/logger.ts). That gives
-- a log line on failure, but log lines aren't queryable: there's no way to
-- ask "what fraction of updateMemory calls have failed this week" or "did
-- extractAndStoreFacts start failing after last night's deploy" without
-- grepping raw log output.
--
-- This table gives those fire-and-forget outcomes a durable, queryable
-- aggregate. It intentionally stores ONE ROW PER LABEL (not one row per
-- call) — an insert-per-call table would take on the full message volume
-- of the hot chat path for zero benefit over the existing log line. Counts
-- are incremented via record_bg_task_outcomes(), which the application
-- layer calls once per job (batched across every tracked task in that
-- job), not once per task — see src/lib/observability/bg-ledger.ts.
--
-- Same access pattern as admin_audit_log (20260935): RLS-enabled with no
-- policies, written and read exclusively via supabaseAdmin (service_role).

CREATE TABLE IF NOT EXISTS bg_task_ledger (
  label            TEXT PRIMARY KEY,

  success_count    BIGINT NOT NULL DEFAULT 0,
  fail_count       BIGINT NOT NULL DEFAULT 0,

  last_success_at  TIMESTAMPTZ,
  last_failure_at  TIMESTAMPTZ,

  -- Most recent failure message + who triggered it, for quick triage
  -- without needing to correlate back into logs. Overwritten on every
  -- new failure — this is "what's happening now," not a history.
  last_error       TEXT,
  last_user_id     UUID,

  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bg_task_ledger_fail_count_idx  ON bg_task_ledger (fail_count DESC);
CREATE INDEX IF NOT EXISTS bg_task_ledger_updated_at_idx  ON bg_task_ledger (updated_at DESC);

ALTER TABLE bg_task_ledger ENABLE ROW LEVEL SECURITY;
-- No policies: service_role (supabaseAdmin) bypasses RLS and is the only
-- writer/reader in application code — see 20260917 RLS-gap migration for
-- why this is the safe default rather than open authenticated policies.

-- ── record_bg_task_outcomes ────────────────────────────────────────────────
--
-- Takes a jsonb array of { label, success, error } — one entry per tracked
-- task in a single job — and upserts all of them in one round trip. Runs
-- as a loop over a single-row-per-label UPSERT rather than a bulk INSERT
-- ... ON CONFLICT because each entry can target a different existing row
-- with different increment targets (success_count vs fail_count); a plain
-- multi-row upsert can't conditionally pick which counter to bump per row
-- without a CASE expression per column, which this keeps simpler at the
-- cost of N small upserts inside one function call instead of N round
-- trips from the client.
CREATE OR REPLACE FUNCTION record_bg_task_outcomes(p_outcomes JSONB, p_user_id UUID DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entry JSONB;
  v_label TEXT;
  v_success BOOLEAN;
  v_error TEXT;
BEGIN
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_outcomes)
  LOOP
    v_label   := v_entry ->> 'label';
    v_success := COALESCE((v_entry ->> 'success')::BOOLEAN, false);
    v_error   := v_entry ->> 'error';

    IF v_label IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO bg_task_ledger (label, success_count, fail_count, last_success_at, last_failure_at, last_error, last_user_id, updated_at)
    VALUES (
      v_label,
      CASE WHEN v_success THEN 1 ELSE 0 END,
      CASE WHEN v_success THEN 0 ELSE 1 END,
      CASE WHEN v_success THEN now() ELSE NULL END,
      CASE WHEN v_success THEN NULL ELSE now() END,
      CASE WHEN v_success THEN NULL ELSE v_error END,
      p_user_id,
      now()
    )
    ON CONFLICT (label) DO UPDATE SET
      success_count   = bg_task_ledger.success_count + CASE WHEN v_success THEN 1 ELSE 0 END,
      fail_count      = bg_task_ledger.fail_count    + CASE WHEN v_success THEN 0 ELSE 1 END,
      last_success_at = CASE WHEN v_success THEN now() ELSE bg_task_ledger.last_success_at END,
      last_failure_at = CASE WHEN v_success THEN bg_task_ledger.last_failure_at ELSE now() END,
      last_error      = CASE WHEN v_success THEN bg_task_ledger.last_error ELSE v_error END,
      last_user_id    = COALESCE(p_user_id, bg_task_ledger.last_user_id),
      updated_at      = now();
  END LOOP;
END;
$$;

-- Privileged, caller-controlled-args RPC — lock down like every other
-- function in 20260930b. Only supabaseAdmin (service_role) calls this.
REVOKE EXECUTE ON FUNCTION record_bg_task_outcomes(JSONB, UUID) FROM authenticated, anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION record_bg_task_outcomes(JSONB, UUID) TO service_role;

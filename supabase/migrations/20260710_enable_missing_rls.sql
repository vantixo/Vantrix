-- ═══════════════════════════════════════════════════════════════════════════
-- RLS-01 fix: three tables were created without ROW LEVEL SECURITY enabled
-- at all — character_lora_jobs, request_logs, xp_events. This was flagged in
-- the July 7 audit and never landed. Verified by actually running all prior
-- migrations against a fresh Postgres instance on 2026-07-10: confirmed
-- these are the only 3 of 75 public tables without RLS.
--
-- Without RLS, any client holding the anon/authenticated key (i.e. every
-- browser session, since NEXT_PUBLIC_SUPABASE_ANON_KEY is public by design)
-- can read/write these tables directly via PostgREST if a GRANT exists on
-- them — bypassing every application-layer check entirely. Enabling RLS
-- with no policy at all for a role means that role gets zero rows, so this
-- fails closed by default; policies below then explicitly re-open exactly
-- the access each table actually needs, matching the service_role +
-- owner-read pattern already used everywhere else in this schema (see
-- character_psychology / memory_graph / xp_events' sibling tables in
-- 20240101_production.sql).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── character_lora_jobs ──────────────────────────────────────────────────
-- No user_id column — ownership is transitive through characters.creator_id.
-- Contains gpu_cost_usd (internal cost data) alongside job status, so the
-- owner read is limited to status-relevant columns via a view rather than
-- exposing cost directly... actually simplest and consistent with the rest
-- of this schema: owners can read their own character's job rows in full,
-- since gpu_cost_usd on your own character isn't a meaningful leak; the
-- real risk was ANY authenticated user reading ANY row, which this closes.
ALTER TABLE character_lora_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lora_jobs_own_read" ON character_lora_jobs;
DROP POLICY IF EXISTS "lora_jobs_service"  ON character_lora_jobs;

CREATE POLICY "lora_jobs_own_read" ON character_lora_jobs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM characters c
      WHERE c.id = character_lora_jobs.character_id
        AND (c.creator_id = auth.uid() OR is_admin())
    )
  );
CREATE POLICY "lora_jobs_service" ON character_lora_jobs FOR ALL TO service_role USING (TRUE);

-- ── request_logs ─────────────────────────────────────────────────────────
-- Raw per-request telemetry (path, status, duration, user_id) — this is
-- operational/debugging data, not something any end user should be able to
-- query even for their own rows (it can reveal internal route structure,
-- timing side-channels, etc.). Service-role only, no owner-read policy at
-- all — same treatment as audit_logs and processed_webhooks above.
ALTER TABLE request_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "request_logs_service" ON request_logs;

CREATE POLICY "request_logs_service" ON request_logs FOR ALL TO service_role USING (TRUE);

-- ── xp_events ────────────────────────────────────────────────────────────
-- Gamification ledger (source, amount per user) — same shape as user_xp /
-- user_streaks / daily_quests, which already follow the own-read +
-- service-role pattern. Bringing this table in line with its siblings.
ALTER TABLE xp_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "xp_events_own_read" ON xp_events;
DROP POLICY IF EXISTS "xp_events_service"  ON xp_events;

CREATE POLICY "xp_events_own_read" ON xp_events FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "xp_events_service"  ON xp_events FOR ALL TO service_role USING (TRUE);

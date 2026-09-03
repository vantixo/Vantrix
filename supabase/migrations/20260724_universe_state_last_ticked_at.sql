-- ─────────────────────────────────────────────────────────────────────────────
-- advanceUniverseTick() idempotency guard — same rationale as
-- 20260711_tick_last_ticked_at.sql (location_economy / city_governance):
-- a dedicated timestamp, written only by the tick engine itself, so a
-- duplicate cron invocation (or a manual re-trigger close to the lock's
-- expiry boundary) can't double-advance the singleton universe_state row.
-- Deliberately NOT reusing updated_at — see the 20260711 migration header
-- for why that was tried and found broken (any unrelated write to the row
-- would falsely block the next legitimate tick).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE universe_state
  ADD COLUMN IF NOT EXISTS last_ticked_at TIMESTAMPTZ;

UPDATE universe_state
   SET last_ticked_at = updated_at
 WHERE last_ticked_at IS NULL;

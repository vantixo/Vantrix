-- ─────────────────────────────────────────────────────────────────────────────
-- Tick idempotency: dedicated timestamps (replaces shared updated_at reuse)
--
-- runEconomyTick / runGovernanceTick guard their UPDATE on a per-row
-- timestamp to prevent a duplicate job (from an overlapping cron
-- invocation, or governance_tick's second entry point via
-- full_universe_tick) from applying the same tick twice. Reusing the
-- existing `updated_at` column for this was tried and found broken: it's
-- refreshed by ANY write to the row, so an unrelated write (a future admin
-- edit, a data-fix script, anything) would silently cause the next
-- legitimate tick to be skipped for up to the full guard window — verified
-- against a live Postgres instance, 100% reproducible, not a rare race.
--
-- last_ticked_at is written ONLY by the tick engines themselves
-- (lib/universe/economy.ts, lib/universe/governance.ts), so it can be
-- trusted as "a tick actually ran at time X" with no ambiguity from
-- unrelated writes.
-- ─────────────────────────────────────────────────────────────────────────────

-- economy ---------------------------------------------------------------------
ALTER TABLE location_economy
  ADD COLUMN IF NOT EXISTS last_ticked_at TIMESTAMPTZ;

UPDATE location_economy
   SET last_ticked_at = updated_at
 WHERE last_ticked_at IS NULL;

CREATE INDEX IF NOT EXISTS location_economy_last_ticked_at_idx
  ON location_economy(location_id, last_ticked_at);

-- governance --------------------------------------------------------------------
ALTER TABLE city_governance
  ADD COLUMN IF NOT EXISTS last_ticked_at TIMESTAMPTZ;

UPDATE city_governance
   SET last_ticked_at = updated_at
 WHERE last_ticked_at IS NULL;

CREATE INDEX IF NOT EXISTS city_governance_last_ticked_at_idx
  ON city_governance(location_id, last_ticked_at);

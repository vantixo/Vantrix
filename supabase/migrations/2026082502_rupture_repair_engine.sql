-- ═══════════════════════════════════════════════════════════════════════
-- Rupture & Repair Engine — schema support
--
-- decision-engine.ts already scores Intent.SetBoundary (respect × negative
-- valence × stress, plus desire-engine's boundaryPull from an activated
-- fear). What's never existed is the other half: tracking that a boundary
-- moment happened, reading the user's NEXT reply to see whether it was
-- repaired, deflected, or escalated, and writing that outcome back into
-- attachment-engine (trust/comfort) and desire-engine (fear_activation).
--
-- This migration adds:
--   1. Two columns on character_psychology to hold the pending-rupture
--      state and a cooldown, so SetBoundary can't fire every single turn
--      once stress crosses the threshold (same spirit as
--      controlled-imperfection.ts's REPEAT_COOLDOWN_TURNS, persisted here
--      because rupture state must survive across requests/days, not just
--      within one process).
--   2. Real CASE arms for 'argument' and 'reconciliation' in
--      update_psychology() — these event names already exist in
--      attachment-engine.ts's PsychologyEvent union but were never given
--      deltas; they silently fell through to the ELSE 0 branch.
--   3. Three new events — 'boundary_set', 'boundary_repaired',
--      'boundary_deflected' — which repair-engine.ts calls directly.
--   4. Two new world_impact_events source values so a genuinely repaired
--      (or unresolved) rupture can leave a durable trace, the same way a
--      gift or confession does.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Pending-rupture state + cooldown ─────────────────────────────────
-- Stored as jsonb rather than several columns: this is read/written as one
-- unit by repair-engine.ts and never queried by column in SQL directly.

ALTER TABLE character_psychology
  ADD COLUMN IF NOT EXISTS pending_rupture jsonb,
  ADD COLUMN IF NOT EXISTS rupture_cooldown_until timestamptz;

COMMENT ON COLUMN character_psychology.pending_rupture IS
  'Set when Intent.SetBoundary fires and a reply is sent. Shape: '
  '{ "intent": "set_boundary", "raised_at": iso8601, "turn": int, '
  '"reason": string }. Cleared by repair-engine.ts once the next user '
  'message is evaluated (repaired, deflected, or escalated). Never '
  'shown to the client.';

COMMENT ON COLUMN character_psychology.rupture_cooldown_until IS
  'While set and in the future, decision-engine.ts dampens '
  'Intent.SetBoundary scoring so a rupture cannot re-fire on every turn '
  'while stress stays elevated. Set by repair-engine.ts after any '
  'resolution (repaired or deflected) to the same cooldown window '
  'regardless of outcome, so the cooldown reflects "this was just '
  'addressed," not a reward/penalty.';

CREATE INDEX IF NOT EXISTS idx_character_psychology_pending_rupture
  ON character_psychology (user_id, character_id)
  WHERE pending_rupture IS NOT NULL;

-- ── 2 & 3. Extend update_psychology() with real deltas ──────────────────
-- Replaces the whole function (CREATE OR REPLACE, same signature) —
-- existing CASE arms are preserved verbatim; only new WHEN branches added.

CREATE OR REPLACE FUNCTION update_psychology(p_user_id UUID, p_character_id UUID, p_event TEXT)
RETURNS VOID AS $$
BEGIN
  INSERT INTO character_psychology (user_id, character_id)
  VALUES (p_user_id, p_character_id)
  ON CONFLICT (user_id, character_id) DO NOTHING;

  UPDATE character_psychology SET
    total_interactions = total_interactions + 1,
    last_interaction   = NOW(),
    updated_at         = NOW(),

    trust = GREATEST(0, LEAST(100, trust + CASE p_event
      WHEN 'message_sent'         THEN 1
      WHEN 'long_session'         THEN 3
      WHEN 'compliment'           THEN 2
      WHEN 'absence_7d'           THEN -3
      WHEN 'absence_14d'          THEN -5
      WHEN 'argument'             THEN -6   -- a real rupture costs trust in the moment
      WHEN 'reconciliation'       THEN 9    -- but a genuine repair rebuilds MORE than the rupture cost —
                                             -- repaired conflict is why trust deepens, not just recovers
      WHEN 'boundary_repaired'    THEN 7
      WHEN 'boundary_deflected'   THEN -3   -- being unheard erodes trust further, distinct from the initial hurt
      WHEN 'ignored_her'          THEN -4
      ELSE 0 END)),

    comfort = GREATEST(0, LEAST(100, comfort + CASE p_event
      WHEN 'message_sent'         THEN 1
      WHEN 'long_session'         THEN 2
      WHEN 'compliment'           THEN 1
      WHEN 'absence_7d'           THEN -2
      WHEN 'absence_14d'          THEN -3
      WHEN 'argument'             THEN -8
      WHEN 'reconciliation'       THEN 5
      WHEN 'boundary_repaired'    THEN 4
      WHEN 'boundary_deflected'   THEN -5
      ELSE 0 END)),

    attachment = GREATEST(0, LEAST(100, attachment + CASE p_event
      WHEN 'message_sent'         THEN 0
      WHEN 'long_session'         THEN 3
      WHEN 'lore_discovered'      THEN 2
      WHEN 'absence_7d'           THEN -2
      WHEN 'absence_14d'          THEN -4
      WHEN 'reconciliation'       THEN 4    -- worked-through conflict deepens the bond, not just restores it
      WHEN 'boundary_repaired'    THEN 3
      ELSE 0 END)),

    happiness = GREATEST(0, LEAST(100, happiness + CASE p_event
      WHEN 'compliment'           THEN 5
      WHEN 'long_session'         THEN 3
      WHEN 'absence_14d'          THEN -5
      WHEN 'argument'             THEN -10
      WHEN 'reconciliation'       THEN 8
      WHEN 'boundary_deflected'   THEN -6
      ELSE 0 END)),

    loneliness = GREATEST(0, LEAST(100, loneliness + CASE p_event
      WHEN 'absence_7d'           THEN 5
      WHEN 'absence_14d'          THEN 10
      WHEN 'message_sent'         THEN -2
      WHEN 'long_session'         THEN -4
      WHEN 'boundary_deflected'   THEN 6   -- being unheard reads as isolating, not just frustrating
      ELSE 0 END)),

    -- Stress is what actually gates SetBoundary in decision-engine.ts's
    -- scoreIntents(); a real repair needs to bring it back down or the
    -- next message can trip SetBoundary again immediately post-cooldown.
    stress = GREATEST(0, LEAST(100, stress + CASE p_event
      WHEN 'argument'             THEN 12
      WHEN 'boundary_set'         THEN 6
      WHEN 'reconciliation'       THEN -14
      WHEN 'boundary_repaired'    THEN -10
      WHEN 'boundary_deflected'   THEN 4   -- stays elevated — nothing was actually resolved
      ELSE 0 END)),

    days_known = GREATEST(days_known, EXTRACT(DAY FROM (NOW() - created_at))::INTEGER)
  WHERE user_id = p_user_id AND character_id = p_character_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 4. New world_impact_events sources ──────────────────────────────────
-- world-expansion.ts's WorldImpactSource union must be updated to match
-- (see the accompanying TS patch) — this is the DB-side half of that type.

ALTER TABLE world_impact_events DROP CONSTRAINT IF EXISTS world_impact_events_source_check;
ALTER TABLE world_impact_events ADD CONSTRAINT world_impact_events_source_check
  CHECK (source IN ('gift', 'milestone', 'decision', 'betrayal', 'confession', 'sacrifice',
                     'rupture_repaired', 'rupture_unresolved'));

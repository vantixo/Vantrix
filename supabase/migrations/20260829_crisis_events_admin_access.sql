-- ─────────────────────────────────────────────────────────────────────────────
-- crisis_events_admin_access — close the "write-only safety table" gap.
--
-- Problem: 20260826_crisis_events.sql restricted SELECT/UPDATE to
-- `profiles.role = 'safety_reviewer'`, but no migration ever created,
-- seeded, or assigned that role to any account, and no admin UI queried
-- the table. Net effect: the crisis-detection pipeline (src/lib/safety/
-- crisis-detection.ts) has been firing and writing rows correctly this
-- whole time, but literally no one — human or otherwise — could see them.
--
-- Fix, in order of what actually matters:
--   1. Existing admins (role = 'admin' OR is_admin = TRUE) get read/update
--      access by default, so the review queue is visible the moment this
--      migration runs — not gated behind a second manual role-grant step
--      that's easy to forget (this is exactly how the gap was created the
--      first time).
--   2. The `safety_reviewer` role/policy is KEPT alongside admin access,
--      not replaced — so you can still hand a non-admin (e.g. a contracted
--      moderator) narrow access to just this table without granting full
--      admin, by running:
--        UPDATE profiles SET role = 'safety_reviewer' WHERE id = '<uuid>';
--
-- The original policies are dropped and replaced (not additively stacked)
-- so there's exactly one obvious set of rules per table, not two competing
-- USING clauses to reason about later.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "safety_reviewer_read_crisis_events"   ON crisis_events;
DROP POLICY IF EXISTS "safety_reviewer_update_crisis_events" ON crisis_events;

CREATE POLICY "safety_staff_read_crisis_events" ON crisis_events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND (profiles.role = 'safety_reviewer' OR profiles.role = 'admin' OR profiles.is_admin = TRUE)
    )
  );

CREATE POLICY "safety_staff_update_crisis_events" ON crisis_events
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND (profiles.role = 'safety_reviewer' OR profiles.role = 'admin' OR profiles.is_admin = TRUE)
    )
  );

COMMENT ON TABLE crisis_events IS
  'Review queue for detected crisis signals (src/lib/safety/crisis-detection.ts). '
  'By the time a row exists, the fixed crisis response has already been sent in '
  'place of the normal AI reply — this table is for human follow-up review, not '
  'real-time gating. Readable by admins by default and by any profile explicitly '
  'granted role = ''safety_reviewer'' (see /admin/crisis in the app).';

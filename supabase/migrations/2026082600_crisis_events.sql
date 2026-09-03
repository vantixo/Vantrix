-- ─────────────────────────────────────────────────────────────────────────────
-- crisis_events — review queue for detected crisis signals
--
-- Unlike abuse_signals (pure background review, never affects the request
-- path), this table is written to AFTER the request path has already
-- acted — by the time a row lands here, crisis-response.ts's fixed reply
-- has already been sent to the user, in place of the normal AI reply.
-- This table exists so a human (or a designated safety reviewer role) can
-- see what fired and decide whether any follow-up is warranted, not to
-- gate anything in real time.
--
-- Stores the triggering message verbatim (unlike abuse_signals, which
-- never stores message content) because a reviewer assessing a real crisis
-- signal needs actual context, not just a category label. Access is
-- restricted to an explicit safety-reviewer role, separate from the
-- general admin role used elsewhere, given the sensitivity of the content.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crisis_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  user_id          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  character_id     UUID REFERENCES characters(id) ON DELETE SET NULL,
  conversation_id  UUID,

  category         TEXT NOT NULL
                   CHECK (category IN ('suicidal_ideation', 'self_harm_intent', 'hopelessness_severe')),
  message_excerpt  TEXT NOT NULL,

  -- Review workflow — deliberately separate status set from abuse_signals'
  -- (confirmed_bot/confirmed_human make no sense here).
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'reviewed_no_action', 'reviewed_followed_up', 'false_positive')),
  reviewed_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at      TIMESTAMPTZ,
  reviewer_notes   TEXT
);

CREATE INDEX IF NOT EXISTS idx_crisis_events_status_created
  ON crisis_events (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crisis_events_user
  ON crisis_events (user_id) WHERE user_id IS NOT NULL;

ALTER TABLE crisis_events ENABLE ROW LEVEL SECURITY;

-- Only service-role (supabaseAdmin) writes rows — no anon/authenticated
-- insert policy is defined, same reasoning as abuse_signals: this can only
-- be populated from trusted server-side code.
--
-- Read/update restricted to a `safety_reviewer` role, NOT the general
-- `admin` role abuse_signals uses — this content is materially more
-- sensitive and access should be deliberately narrower. If no such role
-- exists yet in `profiles`, add it before applying this migration, or
-- temporarily substitute 'admin' and tighten later; do not ship this table
-- world-readable to all admins by default without that decision being
-- made deliberately.
CREATE POLICY "safety_reviewer_read_crisis_events" ON crisis_events
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'safety_reviewer')
  );

CREATE POLICY "safety_reviewer_update_crisis_events" ON crisis_events
  FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'safety_reviewer')
  );

COMMENT ON TABLE crisis_events IS
  'Review queue for detected crisis signals (src/lib/safety/crisis-detection.ts). '
  'By the time a row exists, the fixed crisis response has already been sent in '
  'place of the normal AI reply — this table is for human follow-up review, not '
  'real-time gating. Access restricted to safety_reviewer role, not general admin.';

-- ─────────────────────────────────────────────────────────────────────────────
-- reply_guard_flags — review queue for generated replies blocked by
-- src/lib/moderation/reply-guard.ts
--
-- Same non-blocking-review-only pattern as abuse_signals: by the time a
-- row lands here, the fallback reply has already been substituted and
-- sent. This table exists purely so engineering/safety can see whether
-- the fast blocklist is firing (ideally: never, or extremely rarely) and
-- investigate the upstream cause (prompt, model, specific character) when
-- it does — see reply-guard.ts's header comment.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reply_guard_flags (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  user_id          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  character_id     UUID REFERENCES characters(id) ON DELETE SET NULL,
  conversation_id  UUID,

  category         TEXT NOT NULL,
  blocked_excerpt  TEXT NOT NULL,

  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'reviewed', 'false_positive')),
  reviewed_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at      TIMESTAMPTZ,
  reviewer_notes   TEXT
);

CREATE INDEX IF NOT EXISTS idx_reply_guard_flags_status_created
  ON reply_guard_flags (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reply_guard_flags_character
  ON reply_guard_flags (character_id) WHERE character_id IS NOT NULL;

ALTER TABLE reply_guard_flags ENABLE ROW LEVEL SECURITY;

-- Service-role write only, same reasoning as abuse_signals/crisis_events.
CREATE POLICY "admin_read_reply_guard_flags" ON reply_guard_flags
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

CREATE POLICY "admin_update_reply_guard_flags" ON reply_guard_flags
  FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

COMMENT ON TABLE reply_guard_flags IS
  'Review queue for generated chat replies blocked by src/lib/moderation/reply-guard.ts. '
  'Should fire extremely rarely — frequent rows indicate an upstream prompt/model issue, '
  'not a working-as-intended safety net. General admin role (unlike crisis_events, which '
  'is restricted to safety_reviewer given the more sensitive nature of that content).';

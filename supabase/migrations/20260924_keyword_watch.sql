-- ─────────────────────────────────────────────────────────────────────────────
-- keyword_watchlist / keyword_watch_hits — src/lib/moderation/keyword-watch.ts
--
-- Deliberately separate from reply_guard_flags. reply-guard.ts enforces
-- hard-coded, code-reviewed patterns (blocks/substitutes). This pair of
-- tables backs a log-only feature: admins maintain a list of plain
-- keywords/phrases (or, optionally, regexes) here, keyword-watch.ts tests
-- every user message and character reply against them, and every match is
-- written to keyword_watch_hits for an admin to read. Nothing in this
-- system blocks, substitutes, or alters a message — see keyword-watch.ts's
-- header for the full rationale. Enforcement, if any, is a human decision
-- made after reading the hit, not something this code does automatically.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS keyword_watchlist (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  keyword      TEXT NOT NULL,
  is_regex     BOOLEAN NOT NULL DEFAULT FALSE,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  notes        TEXT,

  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_keyword_watchlist_keyword_unique
  ON keyword_watchlist (lower(keyword));
CREATE INDEX IF NOT EXISTS idx_keyword_watchlist_active
  ON keyword_watchlist (active) WHERE active = TRUE;

CREATE TABLE IF NOT EXISTS keyword_watch_hits (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  keyword_id       UUID REFERENCES keyword_watchlist(id) ON DELETE SET NULL,
  keyword_text     TEXT NOT NULL,
  direction        TEXT NOT NULL CHECK (direction IN ('user_message', 'character_reply')),

  user_id          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  character_id     UUID REFERENCES characters(id) ON DELETE SET NULL,
  conversation_id  UUID,
  excerpt          TEXT NOT NULL,

  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'reviewed', 'dismissed')),
  reviewed_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at      TIMESTAMPTZ,
  reviewer_notes   TEXT
);

CREATE INDEX IF NOT EXISTS idx_keyword_watch_hits_status_created
  ON keyword_watch_hits (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_keyword_watch_hits_character
  ON keyword_watch_hits (character_id) WHERE character_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_keyword_watch_hits_user
  ON keyword_watch_hits (user_id) WHERE user_id IS NOT NULL;

ALTER TABLE keyword_watchlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE keyword_watch_hits ENABLE ROW LEVEL SECURITY;

-- Admin-only, full CRUD on the watchlist itself (service-role/app code
-- path uses supabaseAdmin and bypasses RLS regardless; these policies
-- cover any direct authenticated-client access from an admin UI).
CREATE POLICY "admin_select_keyword_watchlist" ON keyword_watchlist
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

CREATE POLICY "admin_insert_keyword_watchlist" ON keyword_watchlist
  FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

CREATE POLICY "admin_update_keyword_watchlist" ON keyword_watchlist
  FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

CREATE POLICY "admin_delete_keyword_watchlist" ON keyword_watchlist
  FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

-- Admin read/update only on hits, same shape as reply_guard_flags. Writes
-- happen exclusively via supabaseAdmin (service-role) from
-- keyword-watch.ts, never from an authenticated client.
CREATE POLICY "admin_read_keyword_watch_hits" ON keyword_watch_hits
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

CREATE POLICY "admin_update_keyword_watch_hits" ON keyword_watch_hits
  FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

COMMENT ON TABLE keyword_watchlist IS
  'Admin-managed list of plain keywords/phrases (or regexes, if is_regex) to watch for in chat. '
  'Log-only: matching this list never blocks or alters a message. See src/lib/moderation/keyword-watch.ts.';

COMMENT ON TABLE keyword_watch_hits IS
  'Review queue of matches against keyword_watchlist, on both user messages and character replies. '
  'Purely observational — enforcement, if any, is a manual admin decision after reading a hit.';

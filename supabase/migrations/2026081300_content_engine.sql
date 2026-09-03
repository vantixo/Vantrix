-- ─────────────────────────────────────────────────────────────────────────────
-- Content Engine — generates premium character content (images, chat-line
-- variety, video) while staying consistent with each character's existing
-- canon (personality axes, speech_style, canon_sheet_url, lora_model_id,
-- visual_seed). Nothing here bypasses the platform's existing moderation
-- gate (lib/moderation) or the NSFW/age-verification guards already built
-- into generateScene() — generated content lands here as PENDING and an
-- admin must publish it, same pattern as character moderation_status.
-- ─────────────────────────────────────────────────────────────────────────────

-- Optional free-text style/personality guidance an admin can add on top of
-- the character's existing canon fields, to steer generation without
-- editing the character's core definition.
ALTER TABLE characters ADD COLUMN IF NOT EXISTS style_guide_notes TEXT;

CREATE TABLE IF NOT EXISTS character_content_queue (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id    UUID        NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  content_type    TEXT        NOT NULL CHECK (content_type IN ('image', 'chat_line', 'video')),
  status          TEXT        NOT NULL DEFAULT 'queued'
                              CHECK (status IN ('queued', 'generating', 'pending_review', 'published', 'rejected', 'failed')),
  -- Inputs
  prompt_input    TEXT,
  -- Outputs (one of these populated depending on content_type)
  result_text     TEXT,
  result_url      TEXT,
  -- Provenance
  triggered_by    TEXT        NOT NULL DEFAULT 'admin' CHECK (triggered_by IN ('admin', 'cron')),
  created_by      UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_by     UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at     TIMESTAMPTZ,
  -- Moderation
  moderation_category TEXT,
  error           TEXT,
  cost_usd        NUMERIC(10,4),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS content_queue_character_idx ON character_content_queue (character_id, created_at DESC);
CREATE INDEX IF NOT EXISTS content_queue_status_idx    ON character_content_queue (status);

ALTER TABLE character_content_queue ENABLE ROW LEVEL SECURITY;

-- Admin-only table: all reads/writes go through supabaseAdmin (service role,
-- bypasses RLS) from server actions/cron — same access model as the other
-- admin tables (abuse_signals, etc). No policy grants access to anon/
-- authenticated roles, so a client-side query against this table returns
-- nothing regardless of who's asking.
DROP POLICY IF EXISTS "content_queue_admin_only" ON character_content_queue;
CREATE POLICY "content_queue_admin_only" ON character_content_queue FOR ALL USING (false);

-- Published gallery content a character has — what free/premium users
-- actually see. Separate from the queue so publishing is a deliberate,
-- reviewable step rather than generated content going live automatically.
CREATE TABLE IF NOT EXISTS character_content (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id    UUID        NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  queue_item_id   UUID        REFERENCES character_content_queue(id) ON DELETE SET NULL,
  content_type    TEXT        NOT NULL CHECK (content_type IN ('image', 'chat_line', 'video')),
  content_text    TEXT,
  content_url     TEXT,
  is_premium      BOOLEAN     NOT NULL DEFAULT TRUE,
  min_tier        TEXT        NOT NULL DEFAULT 'premium'
                              CHECK (min_tier IN ('free','spark','basic','premium','elite','enterprise')),
  display_order   INTEGER     NOT NULL DEFAULT 0,
  active          BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS character_content_character_idx ON character_content (character_id, content_type, active);

ALTER TABLE character_content ENABLE ROW LEVEL SECURITY;

-- Published content IS user-facing (galleries, opening-line variety, etc.)
-- so it's readable by anyone — writes still only ever happen via
-- supabaseAdmin from the publish action/cron.
DROP POLICY IF EXISTS "character_content_public_read" ON character_content;
CREATE POLICY "character_content_public_read" ON character_content
  FOR SELECT USING (active = true);

DROP POLICY IF EXISTS "character_content_no_client_write" ON character_content;
CREATE POLICY "character_content_no_client_write" ON character_content
  FOR INSERT WITH CHECK (false);

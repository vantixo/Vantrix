-- ─────────────────────────────────────────────────────────────────────────────
-- abuse_signals — system-generated bot/abuse suspicion queue for human/AI review
--
-- Deliberately NOT a blocking mechanism. Nothing in the request path checks
-- this table to deny access — it is written to (fire-and-forget, never
-- awaited on the response) whenever request heuristics look automated, and
-- read by admin tooling so a person (or an AI reviewer, per product
-- direction: no CAPTCHA at signup/login — flag instead of gate) can decide
-- what to do about a given account/IP after the fact.
--
-- ip_hash, not raw IP: same SHA-256-truncated pattern as rate-limit/ai-shield.ts
-- so raw IPs are never persisted.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS abuse_signals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Where this fired
  kind         TEXT NOT NULL,               -- e.g. 'guest_chat', 'chat', 'signup', 'onboarding'
  path         TEXT NOT NULL,

  -- Who (best-effort; both may be null for pre-auth traffic)
  user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ip_hash      TEXT,

  -- Why
  score        INTEGER NOT NULL,            -- 0-100, higher = more bot-like
  reasons      TEXT[]  NOT NULL DEFAULT '{}',
  user_agent   TEXT,

  -- Review workflow
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'reviewing', 'confirmed_bot', 'confirmed_human', 'dismissed')),
  reviewed_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at  TIMESTAMPTZ,
  reviewer_notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_abuse_signals_status_created
  ON abuse_signals (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_abuse_signals_user
  ON abuse_signals (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_abuse_signals_ip_hash
  ON abuse_signals (ip_hash) WHERE ip_hash IS NOT NULL;

ALTER TABLE abuse_signals ENABLE ROW LEVEL SECURITY;

-- Only service-role (supabaseAdmin) writes rows — no anon/authenticated
-- insert policy is defined on purpose, so this can only be populated from
-- trusted server-side code, never directly from a client.
CREATE POLICY "admin_read_abuse_signals" ON abuse_signals
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

CREATE POLICY "admin_update_abuse_signals" ON abuse_signals
  FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

COMMENT ON TABLE abuse_signals IS
  'Non-blocking bot/abuse suspicion queue. Written by src/lib/security/bot-shield.ts. Reviewed via /admin/ops, never used to auto-deny requests.';

-- ─────────────────────────────────────────────────────────────────────────
-- Migration: waitlist
-- Table to collect pre-launch email signups from the marketing website.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.waitlist (
  id           BIGSERIAL PRIMARY KEY,
  email        TEXT        NOT NULL,
  source       TEXT        NOT NULL DEFAULT 'website',   -- 'website' | 'hero' | 'cta' | etc.
  ip_hash      TEXT,                                     -- SHA-256 of IP (GDPR-safe)
  referrer     TEXT,
  user_agent   TEXT,
  confirmed    BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique email across the whole waitlist
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_email_unique ON public.waitlist (LOWER(email));

-- Fast duplicate-check lookup
CREATE INDEX IF NOT EXISTS waitlist_email_idx ON public.waitlist (LOWER(email));

-- Analytics: signups over time
CREATE INDEX IF NOT EXISTS waitlist_created_at_idx ON public.waitlist (created_at DESC);

-- Source breakdown
CREATE INDEX IF NOT EXISTS waitlist_source_idx ON public.waitlist (source);

-- RLS: no public reads/writes — all access goes through the service-role API route
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;

-- Only the service-role key can read or write (API route uses supabaseAdmin)
-- Deny everything from anon / authenticated roles
CREATE POLICY "waitlist_deny_all_anon"
  ON public.waitlist
  FOR ALL
  TO anon
  USING (FALSE);

CREATE POLICY "waitlist_deny_all_auth"
  ON public.waitlist
  FOR ALL
  TO authenticated
  USING (FALSE);

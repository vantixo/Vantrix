-- =============================================================================
-- Vantrix — Age Verification Gate
-- Migration: 20240500_age_verification.sql
-- =============================================================================
-- Adds:
--   1. age_verifications        — per-user verification record (server-write only)
--   2. age_verification_audit   — immutable audit trail of all status changes
--   3. is_user_age_verified()   — guard function for use everywhere else
--   4. get_user_verified_age()  — returns verified age or NULL
--   5. Hard DB-level floor on characters.age (>= 18), backfilled + NOT NULL
-- =============================================================================

-- ── 1. age_verifications ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS age_verifications (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  method               TEXT NOT NULL CHECK (method IN ('self_attestation', 'document', 'third_party')),
  status               TEXT NOT NULL DEFAULT 'unverified'
                         CHECK (status IN ('unverified', 'pending', 'verified', 'rejected', 'expired')),
  date_of_birth        DATE,
  computed_age_at_check INT,
  verification_provider TEXT,
  provider_reference    TEXT,
  rejection_reason      TEXT,
  attempt_count         INT NOT NULL DEFAULT 0,
  verified_at           TIMESTAMPTZ,
  expires_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_age_verifications_status ON age_verifications(status);
CREATE INDEX IF NOT EXISTS idx_age_verifications_expires ON age_verifications(expires_at) WHERE status = 'verified';

-- ── 2. age_verification_audit ──────────────────────────────────────────────────
-- Append-only. Every state transition is logged, including rejected attempts
-- and any later edits to date_of_birth (a common abuse pattern is editing DOB
-- after initial rejection — this table makes that visible).

CREATE TABLE IF NOT EXISTS age_verification_audit (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type   TEXT NOT NULL, -- 'submitted' | 'verified' | 'rejected' | 'expired' | 'dob_changed' | 'document_initiated' | 'webhook_received'
  old_value    JSONB,
  new_value    JSONB,
  ip_address   TEXT,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_age_audit_user ON age_verification_audit(user_id, created_at DESC);

-- ── 3. RLS — users can read their own record, ONLY service role can write ─────
-- This is the important part: verification status must never be settable by
-- a client-side call. All writes happen through the server-side API routes
-- using the service-role key, never through a client Supabase session.

ALTER TABLE age_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE age_verification_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own verification" ON age_verifications;
CREATE POLICY "Users can read own verification" ON age_verifications
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "No client writes to verification" ON age_verifications;
CREATE POLICY "No client writes to verification" ON age_verifications
  FOR ALL USING (false) WITH CHECK (false);
-- service_role bypasses RLS entirely, so server-side writes via supabaseAdmin still work.

DROP POLICY IF EXISTS "No client access to audit log" ON age_verification_audit;
CREATE POLICY "No client access to audit log" ON age_verification_audit
  FOR ALL USING (false) WITH CHECK (false);

-- ── 4. Guard functions — call these from anywhere that gates adult content ────

CREATE OR REPLACE FUNCTION is_user_age_verified(p_user_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM age_verifications
    WHERE user_id = p_user_id
      AND status = 'verified'
      AND (expires_at IS NULL OR expires_at > NOW())
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_user_verified_age(p_user_id UUID)
RETURNS INT AS $$
  SELECT computed_age_at_check FROM age_verifications
  WHERE user_id = p_user_id
    AND status = 'verified'
    AND (expires_at IS NULL OR expires_at > NOW())
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ── 5. Hard floor on characters.age ─────────────────────────────────────────────
-- Backfill any existing NULL ages to a safe adult default, then make the
-- column NOT NULL with a CHECK constraint. This is enforced at the database
-- layer so it can't be bypassed by an application bug, a missing validation
-- branch, or a future engineer forgetting to call a helper function.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'characters' AND column_name = 'age') THEN
    UPDATE characters SET age = 21 WHERE age IS NULL OR age < 18;
    ALTER TABLE characters ALTER COLUMN age SET NOT NULL;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'chk_character_age_adult'
    ) THEN
      ALTER TABLE characters ADD CONSTRAINT chk_character_age_adult CHECK (age >= 18);
    END IF;
  END IF;
END $$;

-- Trigger belt-and-suspenders: reject any insert/update attempt at the
-- statement level too, with a clear error rather than a silent constraint
-- failure, so the API layer can surface a sane message.

CREATE OR REPLACE FUNCTION enforce_character_adult_age()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.age IS NULL OR NEW.age < 18 THEN
    RAISE EXCEPTION 'Character age must be 18 or older (got %)', NEW.age;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_character_adult_age ON characters;
CREATE TRIGGER trg_enforce_character_adult_age
  BEFORE INSERT OR UPDATE OF age ON characters
  FOR EACH ROW EXECUTE FUNCTION enforce_character_adult_age();

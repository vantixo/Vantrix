-- ─────────────────────────────────────────────────────────────────────────────
-- Consolidate age verification to a single source of truth
--
-- Previously there were two systems: age_verifications (authoritative, one
-- row per user, written only by submitSelfAttestation() via the service
-- role) and profiles.age_verified (a denormalized copy kept in sync only by
-- a trigger on age_verifications). Every real check now reads
-- age_verifications directly (middleware.ts, profile/settings/route.ts,
-- profile/page.tsx, characters/route.ts already did for its own gate).
--
-- The trigger-synced column added a failure mode with no upside: if the
-- trigger was ever not applied to a given database, or its sync silently
-- drifted, every request hitting the edge-gate check in middleware would
-- fail closed — indistinguishable from a real "not verified" state, but
-- affecting every user regardless of their actual verification status.
--
-- This migration removes that column, its trigger, and the trigger
-- function entirely. Nothing else reads or writes profiles.age_verified as
-- of this migration — every call site was moved to query age_verifications
-- directly first (see the accompanying code changes).
-- ─────────────────────────────────────────────────────────────────────────────

-- BUG-FIX (found by actually running this migration against a real Postgres
-- instance with the profiles_own_update policy installed, 2026-07-13): this
-- migration originally went straight to DROP COLUMN, which Postgres refuses
-- outright — profiles_own_update's WITH CHECK clause (from
-- 20241100_fix_age_verified_rls.sql) references age_verified directly in a
-- subquery, so the column has a real dependent object. The tempting fix,
-- DROP COLUMN ... CASCADE, would silently delete that entire policy —
-- leaving every other protected column (tier, tokens, role, is_admin,
-- is_disabled) with zero RLS protection against direct client writes, which
-- is a far worse regression than the one this migration set out to fix.
--
-- Correct order: drop the policy, drop the column, recreate the policy
-- without the dead reference — every other protected-column check is
-- preserved unchanged.
DROP POLICY IF EXISTS "profiles_own_update" ON profiles;

DROP TRIGGER  IF EXISTS trg_sync_age_verified       ON age_verifications;
DROP FUNCTION IF EXISTS sync_age_verified_to_profile();

ALTER TABLE profiles DROP COLUMN IF EXISTS age_verified;

CREATE POLICY "profiles_own_update" ON profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND age_verified_at    IS NOT DISTINCT FROM (SELECT age_verified_at    FROM profiles WHERE id = auth.uid())
    AND verification_level = (SELECT verification_level FROM profiles WHERE id = auth.uid())
    AND tier               = (SELECT tier               FROM profiles WHERE id = auth.uid())
    AND tokens             = (SELECT tokens             FROM profiles WHERE id = auth.uid())
    AND role               = (SELECT role               FROM profiles WHERE id = auth.uid())
    AND is_admin           = (SELECT is_admin           FROM profiles WHERE id = auth.uid())
    AND is_disabled        = (SELECT is_disabled        FROM profiles WHERE id = auth.uid())
  );

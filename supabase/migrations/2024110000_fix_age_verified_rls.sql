-- =============================================================================
-- Vantrix — Fix: profiles RLS must not allow client writes to age_verified
-- Migration: 20241100_fix_age_verified_rls.sql
-- =============================================================================
--
-- SECURITY BUG: 20240101_production.sql creates:
--   CREATE POLICY "profiles_own" ON profiles FOR ALL USING (auth.uid() = id);
-- This allows users to UPDATE profiles.age_verified = true directly from the
-- client, bypassing the entire age verification system.
--
-- Fix: Replace the broad FOR ALL policy with:
--   1. SELECT + INSERT policy for own rows (unchanged behavior)
--   2. UPDATE policy that EXCLUDES protected columns via a CHECK constraint
--
-- The trigger-based sync (20240900_age_verified_sync_trigger.sql) runs as
-- SECURITY DEFINER so it can still write age_verified. Service role also
-- bypasses RLS. Only client-side updates are blocked.
-- =============================================================================

-- Drop the overly permissive all-access policy
DROP POLICY IF EXISTS "profiles_own" ON profiles;

-- SELECT: users can read their own profile (unchanged)
CREATE POLICY "profiles_own_select" ON profiles
  FOR SELECT USING (auth.uid() = id);

-- INSERT: needed for new profile creation in /auth/callback
CREATE POLICY "profiles_own_insert" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- UPDATE: users can update their own profile BUT NOT protected columns.
-- Protected columns (age_verified, age_verified_at, verification_level,
-- tier, tokens, role, is_admin, is_disabled) can only be written by the
-- service role or SECURITY DEFINER functions.
--
-- Implementation: allow UPDATE only when the client is NOT changing protected fields.
-- Since Postgres RLS WITH CHECK runs after the update, we compare NEW vs OLD:
CREATE POLICY "profiles_own_update" ON profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    -- Prevent elevation of protected fields via client UPDATE
    AND age_verified       = (SELECT age_verified       FROM profiles WHERE id = auth.uid())
    AND age_verified_at    IS NOT DISTINCT FROM (SELECT age_verified_at    FROM profiles WHERE id = auth.uid())
    AND verification_level = (SELECT verification_level FROM profiles WHERE id = auth.uid())
    AND tier               = (SELECT tier               FROM profiles WHERE id = auth.uid())
    AND tokens             = (SELECT tokens             FROM profiles WHERE id = auth.uid())
    AND role               = (SELECT role               FROM profiles WHERE id = auth.uid())
    AND is_admin           = (SELECT is_admin           FROM profiles WHERE id = auth.uid())
    AND is_disabled        = (SELECT is_disabled        FROM profiles WHERE id = auth.uid())
  );

-- Admin read-all policy (unchanged)
DROP POLICY IF EXISTS "profiles_admin_read" ON profiles;
CREATE POLICY "profiles_admin_read" ON profiles
  FOR SELECT USING (is_admin());

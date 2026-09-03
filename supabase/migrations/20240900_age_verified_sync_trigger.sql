-- =============================================================================
-- Vantrix — Sync profiles.age_verified from age_verifications table
-- Migration: 20240900_age_verified_sync_trigger.sql
-- =============================================================================
--
-- Problem: The middleware age-gate reads profiles.age_verified (fast edge check)
-- but the authoritative record lives in age_verifications (status, expiry, etc).
-- These can get out of sync, which causes the edge gate to either over-block or
-- (worse) under-block.
--
-- Fix: A BEFORE trigger on age_verifications keeps profiles.age_verified as a
-- denormalized read-cache. All writes to age_verifications automatically
-- propagate to profiles so the middleware always sees the correct value.
--
-- Security: profiles.age_verified remains unwritable via client RLS policy.
-- This trigger runs as SECURITY DEFINER and updates it via the service role.
-- =============================================================================

CREATE OR REPLACE FUNCTION sync_age_verified_to_profile()
RETURNS TRIGGER AS $$
BEGIN
  -- Update profiles.age_verified to reflect the authoritative age_verifications status
  UPDATE profiles
  SET age_verified = (
    NEW.status = 'verified'
    AND (NEW.expires_at IS NULL OR NEW.expires_at > NOW())
  )
  WHERE id = NEW.user_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_age_verified ON age_verifications;
CREATE TRIGGER trg_sync_age_verified
  AFTER INSERT OR UPDATE OF status, expires_at ON age_verifications
  FOR EACH ROW
  EXECUTE FUNCTION sync_age_verified_to_profile();

-- ── Backfill: ensure existing age_verifications rows are reflected in profiles ─

UPDATE profiles p
SET age_verified = (
  SELECT av.status = 'verified'
         AND (av.expires_at IS NULL OR av.expires_at > NOW())
  FROM age_verifications av
  WHERE av.user_id = p.id
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1 FROM age_verifications av WHERE av.user_id = p.id
);

-- ── Enforce: profiles.age_verified cannot be set to true via client RLS ───────
-- (This was already the case via RLS on the profiles table, but make it explicit)
-- The only path to age_verified = true is via the trigger above.

-- Ensure RLS is enabled on profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Remove any existing policy that allows clients to write age_verified
-- (belt-and-suspenders: the service role bypasses RLS anyway, but this blocks
-- any accidentally permissive policy)
DROP POLICY IF EXISTS "Users can set age_verified" ON profiles;

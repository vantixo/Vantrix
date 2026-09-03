-- ADMIN-FREE-TIER (follow-up): switch profiles.tier itself to 'enterprise'
-- for admin accounts, rather than only resolving an *effective* tier at
-- the application layer. Simpler mental model — admins really do carry
-- 'enterprise' in the database, so anything that reads profiles.tier
-- directly (admin dashboards, support tooling, ad-hoc SQL, future code
-- that forgets to call resolveEffectiveTier()/requirePlan()) sees the
-- correct value without needing to know about the admin special-case at
-- all. The app-layer bypasses added earlier (resolveEffectiveTier(),
-- requirePlan(), deduct_tokens()) are left in place as defense in depth —
-- harmless no-ops once tier is actually 'enterprise' — rather than removed.

-- 1. Backfill every existing admin account.
UPDATE profiles
SET tier = 'enterprise'
WHERE (role = 'admin' OR is_admin IS TRUE)
  AND tier IS DISTINCT FROM 'enterprise';

-- 2. Keep it there going forward: whenever a row is inserted/updated such
--    that it's admin, force tier to 'enterprise' in the same write —
--    covers new admins being granted the role, and stops any other flow
--    (nightly expiry downgrade, a subscription-cancelled webhook, a manual
--    tier edit) from silently knocking an admin back down to 'free' the
--    next time one of those runs, since none of them know admins are
--    special-cased.
CREATE OR REPLACE FUNCTION enforce_admin_enterprise_tier()
RETURNS TRIGGER AS $$
BEGIN
  IF (NEW.role = 'admin' OR NEW.is_admin IS TRUE) THEN
    NEW.tier := 'enterprise';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_admin_enterprise_tier ON profiles;
CREATE TRIGGER trg_enforce_admin_enterprise_tier
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION enforce_admin_enterprise_tier();

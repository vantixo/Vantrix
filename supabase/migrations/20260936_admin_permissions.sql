-- Granular admin permissions.
--
-- Today, admin access is binary: role='admin' OR is_admin=TRUE grants
-- access to every admin capability in the panel — disabling accounts,
-- adjusting token balances, moderating characters, approving referral
-- partners, publishing content, etc. The 'moderator' role already exists
-- in profiles.role's CHECK constraint but has never been wired to
-- anything narrower than full admin.
--
-- This migration adds a permission grant table for moderators. Admins
-- (role='admin' OR is_admin=TRUE) remain full-access superusers and are
-- NOT gated by this table — this is additive scoping for moderator
-- accounts, not a new admin gate. See src/lib/auth/permissions.ts for the
-- permission list and the runtime check.

CREATE TABLE IF NOT EXISTS admin_permissions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- The moderator this grant applies to.
  moderator_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Permission key, e.g. 'users.disable', 'users.tokens_adjust',
  -- 'characters.moderate'. See AdminPermission union in
  -- src/lib/auth/permissions.ts for the canonical list — kept as free
  -- text here (not a CHECK constraint) so new permissions don't require
  -- a migration, matching the admin_audit_log.action convention.
  permission   TEXT NOT NULL,

  -- Who granted this, for accountability (moderators can't self-grant —
  -- only enforced at the application layer via requirePermission gating
  -- the grant/revoke actions themselves to full admins).
  granted_by   UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,

  UNIQUE (moderator_id, permission)
);

CREATE INDEX IF NOT EXISTS admin_permissions_moderator_idx ON admin_permissions (moderator_id);

ALTER TABLE admin_permissions ENABLE ROW LEVEL SECURITY;
-- No policies: service_role (supabaseAdmin) is the only reader/writer,
-- same reasoning as admin_audit_log and the 20260917 RLS-gap migration.

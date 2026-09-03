-- Admin action audit trail.
--
-- Today, admin actions that mutate user state (disabling an account,
-- adjusting a token balance, moderating a character, etc.) are only
-- recorded via logger.info() calls in src/app/admin/actions.ts — i.e.
-- structured console/log output with no queryable persistence. There is
-- no way to answer "who disabled this user and when" or "who granted
-- this account 50,000 tokens" from the database itself.
--
-- This table gives every state-changing admin action a durable, queryable
-- record. It's written exclusively from server-side admin actions via
-- supabaseAdmin (service_role), same access pattern as every other
-- admin-only table in this codebase — see the 20260917 RLS-gap migration
-- for why RLS-enabled-with-no-policies is the safe default here.

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Who performed the action.
  admin_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,

  -- What kind of action, and what it targeted. action is a free-text enum
  -- managed at the application layer (see AdminAuditAction in
  -- src/lib/admin/audit.ts) rather than a DB CHECK constraint, so new
  -- action types don't require a migration to add.
  action       TEXT NOT NULL,
  target_type  TEXT NOT NULL,               -- e.g. 'user', 'character', 'content_queue_item'
  target_id    TEXT NOT NULL,               -- stored as text: targets aren't all UUIDs (e.g. queue item ids)

  -- Free-form details of the change, e.g. { "delta": 500, "newTotal": 1200 }
  -- or { "disabled": true }. jsonb so each action type can carry whatever
  -- shape is relevant without schema churn.
  metadata     JSONB NOT NULL DEFAULT '{}',

  -- Denormalized label of the target at the time of the action (e.g. the
  -- username being disabled), so the log stays readable even after the
  -- target user/character is later deleted or renamed.
  target_label TEXT
);

CREATE INDEX IF NOT EXISTS admin_audit_log_created_at_idx ON admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_admin_id_idx   ON admin_audit_log (admin_id);
CREATE INDEX IF NOT EXISTS admin_audit_log_target_idx     ON admin_audit_log (target_type, target_id);

ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;
-- No policies: service_role (supabaseAdmin) bypasses RLS and is the only
-- writer/reader in application code. This closes off direct anon/authenticated
-- REST access to the audit trail itself, which would otherwise be readable/
-- writable by any client holding the publishable key (see 20260917 migration).

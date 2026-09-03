import { supabaseAdmin } from '@/lib/supabase/admin';
import { ForbiddenError } from '@/lib/errors';
import { isAdminProfile } from '@/lib/auth/admin';

/**
 * Canonical list of granular admin permissions. Full admins (role='admin'
 * OR is_admin=TRUE) implicitly hold all of these — this list only matters
 * for scoping what a 'moderator'-role account can do. Kept as a union
 * (not a DB CHECK constraint) so adding a new permission is a one-line
 * change here, not a migration — mirrors the AdminAuditAction convention
 * in src/lib/admin/audit.ts.
 */
export type AdminPermission =
  | 'users.disable'
  | 'users.tokens_adjust'
  | 'users.bulk_actions'
  | 'characters.moderate'
  | 'content.publish'
  | 'referrals.approve'
  | 'crisis.review'
  | 'abuse.review'
  | 'reply_guard.review'
  | 'reports.review'
  | 'permissions.manage'; // grant/revoke other moderators' permissions — admin-only in practice, listed for completeness

export const ALL_PERMISSIONS: AdminPermission[] = [
  'users.disable',
  'users.tokens_adjust',
  'users.bulk_actions',
  'characters.moderate',
  'content.publish',
  'referrals.approve',
  'crisis.review',
  'abuse.review',
  'reply_guard.review',
  'reports.review',
  'permissions.manage',
];

export const PERMISSION_LABELS: Record<AdminPermission, string> = {
  'users.disable': 'Disable / re-enable user accounts',
  'users.tokens_adjust': 'Adjust user token balances',
  'users.bulk_actions': 'Run bulk actions on users',
  'characters.moderate': 'Approve / reject characters',
  'content.publish': 'Publish / reject generated content',
  'referrals.approve': 'Approve / reject referral partner applications',
  'crisis.review': 'Review crisis-flagged conversations',
  'abuse.review': 'Review abuse-signal queue',
  'reply_guard.review': 'Review reply guard queue',
  'reports.review': 'Review user-submitted content reports',
  'permissions.manage': 'Grant or revoke moderator permissions',
};

interface CallerProfile {
  role: string | null;
  is_admin: boolean | null;
}

async function loadCallerProfile(userId: string): Promise<CallerProfile | null> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('role, is_admin')
    .eq('id', userId)
    .single();
  if (error || !data) return null;
  return data;
}

/**
 * True if userId holds the given permission — either because they're a
 * full admin (implicit all-permissions) or because they're a moderator
 * with an explicit grant row in admin_permissions.
 *
 * Fail-closed: a moderator with no grant row for a permission does NOT
 * have it. There's no default-allow path for moderators.
 */
export async function hasPermission(userId: string, permission: AdminPermission): Promise<boolean> {
  const profile = await loadCallerProfile(userId);
  if (!profile) return false;
  if (isAdminProfile(profile)) return true; // full admin: implicit all permissions
  if (profile.role !== 'moderator') return false; // not admin, not moderator -> no admin access at all

  const { data, error } = await supabaseAdmin
    .from('admin_permissions')
    .select('id')
    .eq('moderator_id', userId)
    .eq('permission', permission)
    .maybeSingle();

  return !error && !!data;
}

/**
 * Throws ForbiddenError if userId lacks the given permission. Use this at
 * the top of any admin Server Action or route handler that performs a
 * specific privileged mutation, in addition to (not instead of) the
 * broader requireAdmin()/layout gate that confirms the caller has *some*
 * admin access at all.
 */
export async function requirePermission(userId: string, permission: AdminPermission): Promise<true> {
  const ok = await hasPermission(userId, permission);
  if (!ok) {
    throw new ForbiddenError(
      `Missing required permission: ${permission}`,
      'PERMISSION_REQUIRED',
    );
  }
  return true;
}

export interface ModeratorPermissionsRow {
  moderator_id: string;
  username: string | null;
  display_name: string | null;
  permissions: AdminPermission[];
}

/**
 * Lists every moderator-role account and the permissions currently
 * granted to them. Full admins are intentionally excluded — they aren't
 * scoped by this table, so listing them here would be misleading (it
 * would look like an admin could be "missing" a permission).
 */
export async function listModeratorPermissions(): Promise<ModeratorPermissionsRow[]> {
  const { data: moderators, error: modErr } = await supabaseAdmin
    .from('profiles')
    .select('id, username, display_name')
    .eq('role', 'moderator');

  if (modErr || !moderators || moderators.length === 0) return [];

  const { data: grants } = await supabaseAdmin
    .from('admin_permissions')
    .select('moderator_id, permission')
    .in('moderator_id', moderators.map((m) => m.id));

  const grantsByModerator = new Map<string, AdminPermission[]>();
  for (const g of grants ?? []) {
    const list = grantsByModerator.get(g.moderator_id) ?? [];
    list.push(g.permission as AdminPermission);
    grantsByModerator.set(g.moderator_id, list);
  }

  return moderators.map((m) => ({
    moderator_id: m.id,
    username: m.username,
    display_name: m.display_name,
    permissions: grantsByModerator.get(m.id) ?? [],
  }));
}

import { supabaseAdmin } from '@/lib/supabase/admin';
import { ForbiddenError } from '@/lib/errors';

/**
 * Verify that a userId belongs to an admin-role profile.
 *
 * Uses supabaseAdmin (service role) instead of createClient() so this function
 * is safe to call from any context — route handlers, queue workers, or
 * background jobs. createClient() requires Next.js cookies context and throws
 * outside a request lifecycle.
 *
 * Throws ForbiddenError (which maps to HTTP 403) if the user is not an admin.
 */
export async function requireAdmin(userId: string): Promise<true> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('role, is_admin')
    .eq('id', userId)
    .single();

  // BUGFIX: this previously checked `role === 'admin'` only. The database's
  // own is_admin() SQL function — the thing every RLS policy actually uses
  // to decide admin access (see e.g. the characters_own_write policy) — has
  // always granted admin via role = 'admin' OR is_admin = TRUE. An account
  // marked admin only through the is_admin boolean passed every RLS check
  // in the app but was silently rejected by this one frontend gate, which
  // looked exactly like "admin access is broken" with no error surfaced.
  // data.role is typed as string | null, data.is_admin as boolean | null.
  const isAdmin = !error && !!data && (data.role === 'admin' || data.is_admin === true);
  if (!isAdmin) {
    throw new ForbiddenError('Admin access required', 'ADMIN_REQUIRED');
  }

  return true;
}

/**
 * Same check as requireAdmin(), but as a plain boolean predicate over a
 * profile object you already have in hand (no extra DB round-trip).
 *
 * AUDIT FINDING (2026-07-19): the `role === 'admin' OR is_admin` check has
 * already had to be fixed once, inside requireAdmin() itself. That fix
 * didn't prevent the same role-only mistake from being hand-rolled again in
 * at least 8 other places across the codebase (dating/scene, images/
 * generate-batch, voice/tts, chat/image route handlers, plus the referral
 * admin routes) — every one of them checks `profile.role !== 'admin'` and
 * ignores `is_admin`, even in files that already SELECT is_admin into the
 * same profile object. Net effect: an account granted admin only via the
 * is_admin boolean (not role='admin') silently loses the admin token-cost
 * bypass and gets 402'd/403'd on features that should be free/allowed for
 * them — functionally identical to the bug already fixed once, just not
 * caught at every call site. Use this helper instead of re-deriving the
 * condition, so a future fix only has to happen in one place.
 */
export function isAdminProfile(
  profile: { role?: string | null; is_admin?: boolean | null } | null | undefined,
): boolean {
  return !!profile && (profile.role === 'admin' || profile.is_admin === true);
}

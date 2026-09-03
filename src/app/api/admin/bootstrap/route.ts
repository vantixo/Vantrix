/**
 * POST /api/admin/bootstrap
 *
 * Solves the "admin panel is built but nobody can log into it" problem:
 * requireAdmin() (src/lib/auth/admin.ts) checks profiles.is_admin/role, and
 * nothing in this codebase ever sets that for the very first account —
 * every migration leaves is_admin defaulted FALSE for everyone. Without
 * this route, granting the first admin requires a manual SQL UPDATE run
 * directly against Supabase.
 *
 * Auth: gated by ADMIN_SECRET_TOKEN (same operator-only secret already
 * used elsewhere for server-to-server admin calls — see admin/actions.ts,
 * api/admin/ops/route.ts). Not a user session; this is deliberately a
 * pre-auth bootstrap step.
 *
 * Self-locking: refuses to run if ANY profile already has admin rights
 * (role='admin' OR is_admin=true). This is a one-time bootstrap, not a
 * standing "promote anyone to admin" endpoint — once you have your first
 * admin, promote further admins from inside the admin panel itself (or
 * directly in Supabase), not through this route. This also means a leaked
 * ADMIN_SECRET_TOKEN can't be used to mint additional admins after setup,
 * only to (harmlessly) re-attempt bootstrap and get rejected.
 *
 * Usage:
 *   curl -X POST https://vantrix.ink/api/admin/bootstrap \
 *     -H "x-admin-secret: $ADMIN_SECRET_TOKEN" \
 *     -H "Content-Type: application/json" \
 *     -d '{"email":"you@example.com"}'
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin }             from '@/lib/supabase/admin';
import { logger }                    from '@/lib/logger';
import { requireSecret }             from '@/lib/security';
import { env }                       from '@/env';

export const dynamic = 'force-dynamic';

async function findUserIdByEmail(email: string): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  // supabase-js v2's admin API only exposes paginated listUsers(), not a
  // direct getUserByEmail — page through until we find a match. Bootstrap
  // is a one-time, low-frequency operation, so a few extra API calls here
  // is a fine tradeoff for not needing the user's raw UUID.
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find(u => u.email?.toLowerCase() === normalized);
    if (match) return match.id;
    if (data.users.length < 200) break; // last page
  }
  return null;
}

export async function POST(req: NextRequest) {
  // AUDIT FIX (2026-07-19): this route grants the FIRST admin account —
  // arguably the single highest-value secret check in the app — but was
  // comparing the header with a plain `!==` instead of the timing-safe
  // comparison every other secret-gated route in this codebase already
  // uses (see src/lib/security.ts timingSafeEqual / requireSecret,
  // originally added specifically to close this class of gap). A naive
  // `!==` short-circuits on the first differing byte, which leaks enough
  // timing signal to brute-force the token character-by-character.
  // requireSecret() checks the same x-admin-secret header via a
  // constant-time comparison and fails closed if the env var is unset in
  // production.
  if (!requireSecret(req, env.ADMIN_SECRET_TOKEN, 'x-admin-secret')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Self-lock check — see module docstring.
    const { count, error: countErr } = await supabaseAdmin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .or('role.eq.admin,is_admin.eq.true');

    if (countErr) throw countErr;

    if ((count ?? 0) > 0) {
      return NextResponse.json({
        error: 'Admin already bootstrapped. Promote further admins from the admin panel or directly in Supabase, not this endpoint.',
        code:  'ALREADY_BOOTSTRAPPED',
      }, { status: 409 });
    }

    const body = await req.json().catch(() => ({}));
    const email  = typeof body.email  === 'string' ? body.email  : null;
    const userId = typeof body.userId === 'string' ? body.userId : null;

    if (!email && !userId) {
      return NextResponse.json({ error: 'Provide either "email" or "userId" in the request body' }, { status: 400 });
    }

    const targetId = userId ?? await findUserIdByEmail(email!);
    if (!targetId) {
      return NextResponse.json({ error: `No account found for ${email ?? userId}` }, { status: 404 });
    }

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('profiles')
      .update({ is_admin: true, role: 'admin' })
      .eq('id', targetId)
      .select('id, username, display_name')
      .single();

    if (updateErr) throw updateErr;

    logger.info('admin:bootstrap', { userId: targetId });

    return NextResponse.json({
      success: true,
      message: 'Admin access granted. Sign in and visit /admin.',
      profile: updated,
    });
  } catch (err) {
    logger.error('admin:bootstrap-failed', { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: 'Bootstrap failed' }, { status: 500 });
  }
}

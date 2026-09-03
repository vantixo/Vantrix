/**
 * POST /api/profile/ensure
 *
 * Self-heal endpoint for the "valid session, missing profiles row" gap.
 *
 * WIRE-FIX (2026-08-19): this route was orphaned — its own doc comment
 * pointed at a useAuth() hook (src/hooks/use-auth.ts) that doesn't exist
 * anywhere in this codebase, and nothing else called it either. Signup
 * only ever completes through src/app/login/page.tsx (plain
 * supabase.auth.signUp(), no OAuth callback route exists), and that page
 * never called this route — meaning nothing created a profiles row on
 * first login except this unreachable endpoint. Now called directly from
 * login/page.tsx after both sign-up and sign-in complete.
 *
 * Also the natural, already-authenticated choke point for referral
 * attribution: attributeConversion() (@/lib/referral-engine) was built,
 * tested, and documented to run "right after a new user completes
 * signup," but had no caller either. It's idempotent (a no-op if this
 * user already has a conversion row, or never clicked a referral link),
 * so it's safe to attempt on every call here, not just first signup.
 *
 * Uses supabaseAdmin under the hood (via ensureProfile) so it works
 * regardless of RLS state, and is idempotent: safe to call on every
 * sign-in, not just once.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser }             from "@/lib/auth/get-authed-user";
import { supabaseAdmin }             from "@/lib/supabase/admin";
import { ensureProfileWithReferralAttribution } from "@/lib/profile/ensure-profile";
import { logger }                    from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { user } = await getAuthedUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // getAuthedUser() may return a minimal { id } object when trusting the
  // middleware header — ensureProfile needs the real auth.users record
  // (email, etc.) to generate a sensible username on first creation.
  const { data: fullUser, error } = await supabaseAdmin.auth.admin.getUserById(user.id);

  if (error || !fullUser?.user) {
    logger.error("profile.ensure.route.user_lookup_failed", { userId: user.id, error });
    return NextResponse.json({ error: "User lookup failed" }, { status: 500 });
  }

  const profile = await ensureProfileWithReferralAttribution(fullUser.user, req);

  if (!profile) {
    return NextResponse.json({ error: "Could not ensure profile" }, { status: 500 });
  }

  return NextResponse.json(profile);
}

/**
 * GET /auth/callback
 *
 * AUDIT FINDING (2026-08-20): this route did not exist anywhere in the
 * codebase, despite being referenced by stale doc comments in
 * middleware.ts ("Age verification is collected once at signup (see
 * auth/login/page.tsx + auth/callback/page.tsx)"), age-gate.ts
 * ("Records a DOB — either at signup (see auth/callback/page.tsx)..."),
 * and ensure-profile.ts ("Previously this logic lived only inline in
 * /auth/callback (OAuth + email confirmation flow)"). All three describe
 * a route that had clearly existed at some point and was lost — nothing
 * ever rebuilt it, and login/page.tsx's own comment papers over the gap
 * ("no custom /api/auth route exists in this codebase; the client
 * library is the intended integration point"), which is only actually
 * true when Supabase's "Confirm email" setting is OFF.
 *
 * The browser client (@supabase/ssr's createBrowserClient) defaults to
 * PKCE. In that flow, both signup email-confirmation links and
 * password-recovery links redirect back with a `?code=` query param, not
 * tokens in the URL hash — and exchanging that code for a session has to
 * happen somewhere the corresponding `code_verifier` cookie
 * (@supabase/ssr writes it as a cookie precisely so a *server-side* route
 * handler can complete the exchange) is readable, i.e. a Route Handler,
 * not a client component. Without this route:
 *
 *   - If "Confirm email" is enabled in the Supabase project (the normal
 *     production setting, and close to mandatory for an 18+ paid
 *     platform to cut down on throwaway/fake signups), supabase.auth.
 *     signUp() returns a null session. login/page.tsx used to plow ahead
 *     and immediately call the authed-only PATCH /api/profile/
 *     date-of-birth, which 401'd, surfacing "Couldn't verify your age" —
 *     a confusing, wrong error — and silently dropping the DOB, the
 *     profiles-row creation, and referral attribution for every new
 *     signup. See the WIRE-FIX in login/page.tsx for the other half of
 *     this fix (the pending_dob metadata + branch on data.session).
 *   - Password-recovery links landed on /reset-password hoping the
 *     browser client's automatic URL-detection would resolve a session
 *     in time — fragile, and a page.tsx that has since had that
 *     landing point moved through here instead. See forgot-password/
 *     page.tsx's redirectTo.
 *
 * This route also finishes the age-verification + profile-creation
 * side effects for a signup that only becomes authenticated at this
 * point (i.e. the confirm-email case) — see submitSelfAttestation() and
 * ensureProfileWithReferralAttribution() below.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient }              from "@/lib/supabase/server";
import { supabaseAdmin }             from "@/lib/supabase/admin";
import { ensureProfileWithReferralAttribution } from "@/lib/profile/ensure-profile";
import { submitSelfAttestation, getAgeVerification } from "@/lib/age-verification/age-gate";
import { captureEvent }              from "@/lib/analytics/server";
import { logger }                    from "@/lib/logger";

export const dynamic = "force-dynamic";

// SEC-01 — same same-origin-only redirect guard used by login/page.tsx
// (src/__tests__/sec-01-open-redirect.test.ts): only a path starting with
// a single "/" is ever honored.
function sanitizeRedirect(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get("code");
  const next = sanitizeRedirect(searchParams.get("next"));

  if (!code) {
    logger.warn("auth.callback.missing_code");
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    logger.error("auth.callback.exchange_failed", { error: error?.message });
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
  }

  const user = data.user;

  // pending_dob is set on user_metadata at signup time (see
  // login/page.tsx) only when the immediate-session path wasn't taken —
  // i.e. only relevant the first time a brand-new signup confirms their
  // email. Returning users hitting this route via a password-recovery
  // link won't have it set (already cleared below on first use).
  const pendingDob =
    typeof user.user_metadata?.pending_dob === "string"
      ? user.user_metadata.pending_dob
      : null;

  if (pendingDob) {
    const existing = await getAgeVerification(user.id);

    if (existing.status === "unverified") {
      const ip =
        req.headers.get("x-real-ip")?.trim() ||
        req.headers.get("cf-connecting-ip")?.trim() ||
        req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();

      const result = await submitSelfAttestation(user.id, pendingDob, {
        ipAddress: ip || undefined,
        userAgent: req.headers.get("user-agent") ?? undefined,
      });

      if (result.status === "rejected") {
        // Mirrors age-gate.ts's own invariant: a rejected DOB must never
        // leave the account able to act as signed in. Sign the session
        // right back out before redirecting.
        logger.info("auth.callback.under_18_signup_rejected", { userId: user.id });
        await supabase.auth.signOut();
        return NextResponse.redirect(`${origin}/login?error=under_18`);
      }

      // Fired here, not client-side, precisely because this path only
      // runs when the client-side signup flow couldn't have fired it
      // itself (no session existed at signup time) — see the
      // signup_completed comment in login/page.tsx for the mirror-image
      // case. distinctId is passed explicitly so this merges onto the
      // same PostHog person as any pre-signup anonymous events, even
      // though the confirmation click may happen in a completely
      // different browser/device (e.g. opening the email on a phone).
      await captureEvent(user.id, "signup_completed", { method: "email" });
    }

    // Clear pending_dob unconditionally once processed (verified, rejected,
    // or already-pending-review) so a later visit to this route — e.g. a
    // password-recovery link for the same account — never reprocesses it
    // or re-fires signup_completed.
    const restMetadata = { ...(user.user_metadata ?? {}) };
    delete restMetadata.pending_dob;
    await supabaseAdmin.auth.admin.updateUserById(user.id, {
      user_metadata: restMetadata,
    });
  }

  await ensureProfileWithReferralAttribution(user, req);

  return NextResponse.redirect(`${origin}${next}`);
}

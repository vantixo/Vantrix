import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

/**
 * MFA (TOTP) support — Supabase Auth's own `auth.mfa` namespace, not a
 * bespoke implementation. Supabase already does secret generation, QR/URI
 * rendering, code verification, and per-session step-up (Authenticator
 * Assurance Level) server-side; building any of that ourselves would just
 * be a worse, unaudited copy of what GoTrue already provides. This module
 * is the thin server-side glue around it: computing whether the CURRENT
 * session needs to step up (aal1 -> aal2) before the shell renders, and
 * counting verified factors for the Settings badge. Enrollment itself
 * (enroll/challenge/verify/unenroll) happens client-side in
 * components/profile/two-factor-settings.tsx and app/login/verify — those
 * calls are inherently bound to the browser's current session the same
 * way signInWithPassword() already is elsewhere in this app (see
 * login-form.tsx's own header comment on that pattern), not something a
 * server action can do on the user's behalf.
 *
 * NOTE on scope: Supabase's own docs are explicit that TOTP recovery
 * codes are "not supported" — the documented mitigation is enrolling a
 * second factor as backup (up to 10 factors/user), not a bespoke
 * recovery-code table. Building custom recovery codes would also need
 * its own way to promote a session to aal2 outside Supabase's
 * challenge/verify flow, which doesn't exist — so recovery here follows
 * Supabase's own guidance: encourage a second enrolled factor, and fall
 * back to support (which can remove a factor via the service-role admin
 * API) for a user who loses every device. See TwoFactorSettings' empty
 * state for the second-factor prompt.
 *
 * SCOPE NOTE: the aal2 gate below is enforced at the page-shell layer
 * ((app)/layout.tsx, via getShellSession) — it blocks all UI access
 * until step-up completes, which is what a signed-in user actually
 * experiences. It is not additionally enforced per-table via RLS (e.g.
 * `(select auth.jwt()->>'aal') = 'aal2'` policies, which Supabase's own
 * docs show as the belt-and-suspenders option for specific
 * high-sensitivity tables). Adding that is a deliberate follow-up, not
 * an oversight — it touches RLS policy on tables across the schema and
 * is a separate, reviewable change rather than something to fold into
 * the initial feature.
 */

export interface AalStatus {
  /** True when the session is aal1 but the account has a verified factor requiring aal2. */
  mfaRequired: boolean;
}

/**
 * Computes step-up status from an already-hydrated supabase server
 * client (i.e. one that has already had `auth.getUser()` called on it
 * this request) — no extra network round trip, since
 * getAuthenticatorAssuranceLevel() only reads the session already held
 * in memory. Exported separately from getShellSession (lib/frontend/
 * session.ts) so that function doesn't need to import this module's
 * doc-comment context, but the two are meant to be called together.
 */
export async function getAalStatus(
  supabase: SupabaseClient
): Promise<AalStatus> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) {
    // Fail open on a decode error the same way the rest of the app's
    // auth plumbing fails open on a degraded Auth service (see
    // middleware.ts's own session-refresh-error handling) — a step-up
    // gate that's mis-detected as "required" for every request on an
    // Auth hiccup would lock every MFA-enrolled user out of the app
    // entirely, which is a worse outcome than rendering a request that
    // Supabase's own RLS aal2 checks (where configured) would still
    // reject at the data layer.
    if (error) logger.warn("mfa:aal-check-failed", { error: error.message });
    return { mfaRequired: false };
  }
  return { mfaRequired: data.nextLevel === "aal2" && data.currentLevel !== data.nextLevel };
}

/** Verified TOTP factor count for the current user — Settings page badge only. */
export async function getVerifiedTotpFactorCount(): Promise<number> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return 0;

  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error || !data) {
    if (error) logger.warn("mfa:list-factors-failed", { userId: user.id, error: error.message });
    return 0;
  }
  return data.totp.filter((f) => f.status === "verified").length;
}

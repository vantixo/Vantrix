"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { capture } from "@/lib/analytics/client";
import { hasAnyGuestTranscript } from "@/lib/guest-transcript";

/**
 * Phase 1 (§12) — minimal, real auth against Supabase directly (the
 * client library is the intended integration point per FRONTEND_DIRECTIVE
 * §10; the one exception is /api/auth/login-guard, added 2026-08-21
 * purely for failed-attempt lockout — see lib/auth/login-guard.ts — which
 * doesn't touch the actual credential check itself). The one server-side
 * piece that *is* required for the credential check — completing a
 * signup once Supabase's own "Confirm email" flow is involved — lives at
 * /auth/callback/route.ts; see that file's header for the full story.
 *
 * Signup collects date of birth. When Supabase returns a session
 * immediately (email confirmation OFF), the DOB is submitted right away
 * via PATCH /api/profile/date-of-birth (age-gate.ts's
 * submitSelfAttestation), the same endpoint the settings page re-entry
 * point uses. Under-18 signups are rejected post-auth-creation with a
 * clear message; we don't attempt to un-create the Supabase auth user
 * here, since age-gate.ts's rejection path is the source of truth for
 * blocking access, not auth existence.
 *
 * AUDIT FIX (2026-08-20): when Supabase returns no session (email
 * confirmation ON — the normal production setting), the code used to
 * plow ahead into that same authed-only PATCH call anyway, which 401'd
 * and surfaced a misleading "Couldn't verify your age" error while
 * silently dropping the DOB, the profiles row, and referral attribution
 * for every single signup. The DOB is now carried as `pending_dob` in
 * the auth user's metadata (passed to signUp()'s `options.data`) and
 * completed server-side by /auth/callback once the user actually clicks
 * their confirmation link — see that route for the rest. This branch
 * also now recognizes Supabase's "identities: []" signal for an
 * already-registered email (returned as a fake success, not an error, to
 * avoid enumeration) and tells the person to sign in instead of showing
 * them a bogus age-verification failure.
 *
 * LOGIN-PORTRAITS-WIRE-FIX: split out of page.tsx so the page itself can
 * be a Server Component (fetches the portrait collage with zero client
 * waterfall — see src/lib/config/login-portraits.ts). This file is
 * unchanged behaviorally from before the split, just no longer also
 * exporting the page's default and no longer owning the full-viewport
 * layout div — the parent page now provides that (and the collage next
 * to it), this component now only renders the form card itself.
 */
/**
 * SEC-01 — same open-redirect guard mirrored in
 * src/__tests__/sec-01-open-redirect.test.ts: only a same-origin path
 * starting with a single "/" is ever honored. Absolute URLs,
 * protocol-relative ("//evil.com"), and anything else falls back to "/".
 */
function sanitizeRedirect(raw: string | null | undefined): string {
  const candidate = raw ?? "/";
  return candidate.startsWith("/") && !candidate.startsWith("//") ? candidate : "/";
}

// WIRE-FIX (2026-08-19): honors ?mode=sign-up so /r/[code] (the referral
// redirect route) can land a visitor straight into account creation instead
// of the sign-in tab. Any other/missing value falls back to sign-in, same
// as before.
function initialMode(searchParams: URLSearchParams): "sign-in" | "sign-up" {
  return searchParams.get("mode") === "sign-up" ? "sign-up" : "sign-in";
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = sanitizeRedirect(searchParams.get("redirect"));

  const [mode, setMode] = useState<"sign-in" | "sign-up">(() => initialMode(searchParams));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmationSentTo, setConfirmationSentTo] = useState<string | null>(null);

  // WIRE-FIX (2026-08-19): nothing called this route, so no profiles row
  // ever got created outside it (see the route's own doc comment) — and
  // referral attribution, which piggybacks on this same call, never ran
  // either. Best-effort: a failure here shouldn't block sign-in/sign-up,
  // it just means self-heal/attribution didn't run for this particular
  // request (matches the route's own fail-open posture server-side).
  async function ensureProfileAndAttribution() {
    try {
      await fetch("/api/profile/ensure", { method: "POST" });
    } catch {
      // best-effort — see comment above
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();

    if (mode === "sign-in") {
      // FEATURE (2026-08-21): lib/auth/login-guard.ts — see that file's
      // header for why this can't just be a Supabase-side setting alone.
      // Checked before Supabase is even called so a locked-out attempt
      // never burns one of Supabase's own rate-limit counters either.
      const guardCheck = await fetch("/api/auth/login-guard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check", email }),
      })
        .then((res) => res.json())
        .catch(() => ({ locked: false }));

      if (guardCheck?.locked) {
        setLoading(false);
        const minutes = Math.max(1, Math.ceil((guardCheck.retryAfterSeconds ?? 900) / 60));
        setError(`Too many failed attempts. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`);
        return;
      }

      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      setLoading(false);
      if (authError) {
        fetch("/api/auth/login-guard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "record-failure", email }),
        }).catch(() => {});
        setError(authError.message);
        return;
      }
      fetch("/api/auth/login-guard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "record-success", email }),
      }).catch(() => {});
      await ensureProfileAndAttribution();

      // MFA STEP-UP CHECK: signInWithPassword() above only gets the
      // session to aal1. An account with a verified TOTP factor
      // (components/profile/two-factor-settings.tsx) needs a second
      // step before it's actually let in. (app)/layout.tsx enforces this
      // server-side as the source of truth (see lib/auth/mfa.ts) — this
      // check just sends the user straight to the challenge screen from
      // here instead of making them bounce through a redirect from the
      // destination page first.
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== aal.nextLevel) {
        router.push(`/login/verify?redirect=${encodeURIComponent(redirectTo)}`);
        return;
      }

      router.push(redirectTo);
      router.refresh();
      return;
    }

    if (password.length < 10 || !/[^A-Za-z0-9]/.test(password)) {
      setLoading(false);
      setError("Password must be at least 10 characters and include one special character.");
      return;
    }

    const { data, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Consumed server-side by /auth/callback once the user clicks
        // their confirmation link — the DOB has nowhere else to live in
        // the meantime, since no session (and therefore no authed PATCH
        // call) exists until then.
        data: { pending_dob: dateOfBirth },
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(redirectTo)}`,
      },
    });

    if (authError) {
      setLoading(false);
      setError(authError.message);
      return;
    }

    // Supabase's own anti-enumeration behavior: signing up with an email
    // that already has an account returns a *successful* response (no
    // authError) with an empty identities array and no session, rather
    // than an error that would let this form be used to check which
    // emails are registered. Without this check, that case fell straight
    // through to the DOB PATCH below, 401'd, and told a returning user
    // their age couldn't be verified — instead of the actual problem.
    if (data.user && data.user.identities && data.user.identities.length === 0) {
      setLoading(false);
      setError("An account with this email already exists. Try signing in instead.");
      setMode("sign-in");
      return;
    }

    if (!data.session) {
      // Email confirmation is required — there's no session yet to
      // attach the DOB PATCH call to. The DOB already went up as
      // pending_dob metadata above; /auth/callback finishes the job
      // (age verification, profile creation, referral attribution, and
      // the signup_completed event) once the confirmation link is
      // clicked, possibly in a different browser/tab entirely.
      setLoading(false);
      setConfirmationSentTo(email);
      return;
    }

    const dobRes = await fetch("/api/profile/date-of-birth", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dateOfBirth }),
    });
    setLoading(false);

    if (!dobRes.ok) {
      const body = await dobRes.json().catch(() => ({}));
      setError(body.error ?? "Couldn't verify your age.");
      return;
    }

    // Fired here, not right after signUp() above — this is the actual
    // completion point (auth account created AND age-verified); an
    // account that fails the DOB check never finishes signing up. Method
    // is 'guest_claim' rather than 'email' when a guest transcript is
    // sitting in localStorage (see hasAnyGuestTranscript's own comment)
    // — 'google' isn't reachable from this form since there's no OAuth
    // button here yet. (The email-confirmation-required path above fires
    // this same event server-side from /auth/callback instead, since no
    // session exists here to attribute it to yet.)
    capture("signup_completed", {
      method: hasAnyGuestTranscript() ? "guest_claim" : "email",
    });

    await ensureProfileAndAttribution();

    router.push("/");
    router.refresh();
  }

  return (
    <div className="w-full max-w-[400px]">
        <div className="flex items-center gap-2.5 mb-10 justify-center">
          <span className="h-9 w-9 rounded-xs bg-gold-fill flex items-center justify-center font-display font-bold text-[#160F02]">
            V
          </span>
          <span className="font-display text-2xl tracking-tight">
            Vantrix
          </span>
        </div>

        {confirmationSentTo ? (
          <div className="text-center">
            <h1 className="font-display text-2xl mb-2 text-balance">Check your email</h1>
            <p className="text-text-secondary text-sm mb-8">
              We&apos;ve sent a confirmation link to {confirmationSentTo}. Click it to finish
              creating your account — your date of birth and everything else you entered will
              be saved automatically.
            </p>
            <Link href="/login" className="text-gold-400 hover:text-gold-300 text-sm font-medium">
              Back to sign in
            </Link>
          </div>
        ) : (
          <>
            <h1 className="font-display text-3xl text-center mb-2 text-balance">
              {mode === "sign-in" ? "Welcome back" : "Create your account"}
            </h1>
            <p className="text-text-secondary text-center text-sm mb-8">
              {mode === "sign-in"
                ? "Sign in to continue your conversations."
                : "Join Vantrix to create and chat with AI companions."}
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs uppercase tracking-wide text-text-secondary mb-1.5">
                  Email
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-sm bg-base border border-interactive text-text-primary text-[15px] focus:border-gold-500/60 outline-none transition-colors ease-premium"
                  placeholder="you@example.com"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs uppercase tracking-wide text-text-secondary">
                    Password
                  </label>
                  {mode === "sign-in" && (
                    <Link
                      href="/forgot-password"
                      className="text-xs text-gold-400 hover:text-gold-300"
                    >
                      Forgot password?
                    </Link>
                  )}
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={mode === "sign-up" ? 10 : 8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full h-11 px-3.5 pr-11 rounded-sm bg-base border border-interactive text-text-primary text-[15px] focus:border-gold-500/60 outline-none transition-colors ease-premium"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-text-tertiary hover:text-text-secondary transition-colors ease-premium"
                  >
                    {showPassword ? (
                      <EyeOff className="h-[18px] w-[18px]" />
                    ) : (
                      <Eye className="h-[18px] w-[18px]" />
                    )}
                  </button>
                </div>
                {mode === "sign-up" && (
                  <p className="text-xs text-text-tertiary mt-1.5">
                    At least 10 characters, including one special character.
                  </p>
                )}
              </div>

              {mode === "sign-up" && (
                <div>
                  <label className="block text-xs uppercase tracking-wide text-text-secondary mb-1.5">
                    Date of birth
                  </label>
                  <input
                    type="date"
                    required
                    value={dateOfBirth}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                    max={new Date().toISOString().slice(0, 10)}
                    className="w-full h-11 px-3.5 rounded-sm bg-base border border-interactive text-text-primary text-[15px] focus:border-gold-500/60 outline-none transition-colors ease-premium [color-scheme:dark]"
                  />
                  <p className="text-xs text-text-tertiary mt-1.5">
                    You must be 18 or older to use Vantrix.
                  </p>
                </div>
              )}

              {error && (
                <p className="text-sm text-danger" role="alert">
                  {error}
                </p>
              )}

              <Button
                type="submit"
                variant="primary"
                size="lg"
                disabled={loading}
                className="w-full"
              >
                {loading
                  ? "Please wait…"
                  : mode === "sign-in"
                    ? "Sign in"
                    : "Create account"}
              </Button>
            </form>

            <p className="text-center text-sm text-text-secondary mt-6">
              {mode === "sign-in" ? "New to Vantrix?" : "Already have an account?"}{" "}
              <button
                onClick={() =>
                  setMode(mode === "sign-in" ? "sign-up" : "sign-in")
                }
                className="text-gold-400 hover:text-gold-300 font-medium"
              >
                {mode === "sign-in" ? "Create an account" : "Sign in"}
              </button>
            </p>

            <p className="text-center text-xs text-text-tertiary mt-8">
              By continuing you agree to Vantrix&apos;s{" "}
              <Link href="/terms" className="underline hover:text-text-secondary">
                Terms
              </Link>{" "}
              and{" "}
              <Link href="/privacy" className="underline hover:text-text-secondary">
                Privacy Policy
              </Link>
              .
            </p>
          </>
        )}
      </div>
  );
}

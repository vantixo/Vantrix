"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

/**
 * SEC-01 — same guard duplicated at every redirect entry point in this
 * app (see login-form.tsx's own copy and its mirrored unit test at
 * src/__tests__/sec-01-open-redirect.test.ts). Only a same-origin path
 * starting with a single "/" is ever honored.
 */
function sanitizeRedirect(raw: string | null | undefined): string {
  const candidate = raw ?? "/";
  return candidate.startsWith("/") && !candidate.startsWith("//") ? candidate : "/";
}

type Status = "checking" | "needs-code" | "not-needed" | "no-factor";

/**
 * Reached from login-form.tsx right after a password sign-in that needs
 * step-up, or from (app)/layout.tsx's server-side redirect for a
 * still-aal1 session hitting a protected route directly. Both cases
 * converge here, so this re-derives everything from the live session on
 * mount rather than trusting anything passed in — a direct/stale visit
 * with nothing left to verify just moves on immediately.
 */
export function MfaVerifyForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = sanitizeRedirect(searchParams.get("redirect"));

  const [status, setStatus] = useState<Status>("checking");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [factorName, setFactorName] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (cancelled) return;

      if (!aal || aal.currentLevel === aal.nextLevel) {
        // Nothing to verify (either no session or already aal2) —
        // nothing for this screen to do.
        setStatus("not-needed");
        router.replace(redirectTo);
        return;
      }

      const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
      if (cancelled) return;
      const factor = factors?.totp.find((f) => f.status === "verified");
      if (listError || !factor) {
        setStatus("no-factor");
        return;
      }
      setFactorId(factor.id);
      setFactorName(factor.friendly_name ?? null);
      setStatus("needs-code");
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId || code.trim().length < 6) return;
    setSubmitting(true);
    setError(null);

    const supabase = createClient();
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
    if (challengeError || !challenge) {
      setSubmitting(false);
      setError(challengeError?.message ?? "Couldn't verify — try again.");
      return;
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code: code.trim(),
    });
    setSubmitting(false);
    if (verifyError) {
      setError(verifyError.message);
      return;
    }

    router.push(redirectTo);
    router.refresh();
  }

  async function signOutAndRestart() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (status === "checking" || status === "not-needed") {
    return (
      <div className="flex items-center gap-2 text-sm text-text-tertiary">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking your session…
      </div>
    );
  }

  if (status === "no-factor") {
    // Shouldn't normally be reachable (getAuthenticatorAssuranceLevel
    // already said a factor exists), but a factor removed from another
    // tab between those two calls is a real, if rare, race — fail safe
    // by sending them back to a fresh sign-in rather than getting stuck.
    return (
      <div className="w-full max-w-[380px] text-center">
        <p className="text-text-secondary text-sm mb-6">
          Something went wrong loading your two-factor device. Please sign in again.
        </p>
        <Button onClick={signOutAndRestart} variant="secondary" size="md">
          Back to sign in
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[380px]">
      <div className="flex items-center justify-center mb-6">
        <ShieldCheck className="h-8 w-8 text-gold-400" />
      </div>
      <h1 className="font-display text-2xl text-center mb-2 text-balance">Enter your code</h1>
      <p className="text-text-secondary text-center text-sm mb-8">
        {factorName
          ? `Open your authenticator app (${factorName}) and enter the 6-digit code.`
          : "Open your authenticator app and enter the 6-digit code."}
      </p>

      <form onSubmit={submit} className="space-y-4">
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={6}
          value={code}
          onChange={(e) => {
            setCode(e.target.value.replace(/\D/g, ""));
            setError(null);
          }}
          placeholder="000000"
          className="w-full h-12 px-3.5 rounded-sm bg-base border border-interactive text-text-primary text-lg tracking-[0.4em] text-center focus:border-gold-500/60 outline-none transition-colors ease-premium"
        />

        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}

        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={submitting || code.trim().length < 6}
          className="w-full"
        >
          {submitting ? "Verifying…" : "Verify"}
        </Button>
      </form>

      <div className="text-center mt-6 space-y-2">
        <p className="text-xs text-text-tertiary">
          Lost access to this device?{" "}
          <Link href="/support" className="text-gold-400 hover:text-gold-300">
            Contact support
          </Link>
        </p>
        <button
          onClick={signOutAndRestart}
          className="text-xs text-text-tertiary hover:text-text-secondary underline"
        >
          Sign in as someone else
        </button>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

/**
 * Requests a Supabase password-recovery email.
 *
 * AUDIT FIX (2026-08-20): this used to redirect straight to
 * /reset-password and rely on the browser client's automatic
 * detectSessionInUrl to resolve a session client-side. That's fragile
 * under the PKCE flow @supabase/ssr's createBrowserClient defaults to —
 * the code_verifier needed to complete the exchange is stored in a
 * cookie specifically so a *server-side* route handler can consume it
 * reliably, not left to a client component racing a page load. Recovery
 * links now redirect through /auth/callback/route.ts, which performs the
 * exchange server-side (setting real session cookies) before handing off
 * to /reset-password — see that route's header for the full rationale.
 * reset-password/page.tsx's auth.updateUser({ password }) call then just
 * uses the session that's already sitting in cookies by the time it
 * mounts.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();

    const { error: authError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    setLoading(false);
    // Always show the same success state regardless of whether the email
    // exists — don't let this endpoint be used to enumerate accounts.
    if (authError) {
      setError(authError.message);
      return;
    }
    setSent(true);
  }

  return (
    <div className="min-h-screen bg-base flex items-center justify-center px-6">
      <div className="w-full max-w-[400px]">
        <div className="flex items-center gap-2.5 mb-10 justify-center">
          <span className="h-9 w-9 rounded-xs bg-gold-fill flex items-center justify-center font-display font-bold text-[#160F02]">
            V
          </span>
          <span className="font-display text-2xl tracking-tight">Vantrix</span>
        </div>

        {sent ? (
          <div className="text-center">
            <h1 className="font-display text-2xl mb-2 text-balance">Check your email</h1>
            <p className="text-text-secondary text-sm mb-8">
              If an account exists for {email}, we&apos;ve sent a link to reset your
              password. It expires shortly, so use it soon.
            </p>
            <Link href="/login" className="text-gold-400 hover:text-gold-300 text-sm font-medium">
              Back to sign in
            </Link>
          </div>
        ) : (
          <>
            <h1 className="font-display text-2xl text-center mb-2 text-balance">
              Reset your password
            </h1>
            <p className="text-text-secondary text-center text-sm mb-8">
              Enter the email on your account and we&apos;ll send you a reset link.
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

              {error && (
                <p className="text-sm text-danger" role="alert">
                  {error}
                </p>
              )}

              <Button type="submit" variant="primary" size="lg" disabled={loading} className="w-full">
                {loading ? "Sending…" : "Send reset link"}
              </Button>
            </form>

            <p className="text-center text-sm text-text-secondary mt-6">
              <Link href="/login" className="text-gold-400 hover:text-gold-300 font-medium">
                Back to sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

// Mirrors CODE-03 (see src/__tests__/code-03-password-policy.test.ts):
// Supabase Auth's own minimum is 6 chars with no character-class
// requirement, which is weaker than we want. This is the client-side
// gate that keeps a real strength floor in front of that default.
const SPECIAL_CHAR_RE = /[^A-Za-z0-9]/;

function validatePassword(password: string): { ok: boolean; error?: string } {
  if (password.length < 10) {
    return { ok: false, error: "Password must be at least 10 characters." };
  }
  if (!SPECIAL_CHAR_RE.test(password)) {
    return { ok: false, error: "Password must include at least one special character." };
  }
  return { ok: true };
}

/**
 * Landed on via /auth/callback (see that route's header), which has
 * already exchanged the recovery link's code for a real session and set
 * it in cookies server-side by the time this page's JS even runs. The
 * getSession() call below just reads that already-established session —
 * it isn't racing a client-side URL-token exchange the way it used to
 * before /auth/callback existed.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [sessionError, setSessionError] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Give the client a tick to exchange the URL's recovery token for a
    // session before we decide whether the form should render at all.
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      setSessionError(!data.session);
      setReady(true);
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    const check = validatePassword(password);
    if (!check.ok) {
      setError(check.error ?? "Invalid password.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error: authError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (authError) {
      setError(authError.message);
      return;
    }
    setDone(true);
    setTimeout(() => {
      router.push("/login");
    }, 1500);
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

        {!ready ? (
          <p className="text-center text-text-secondary text-sm">Verifying your link…</p>
        ) : sessionError ? (
          <div className="text-center">
            <h1 className="font-display text-2xl mb-2 text-balance">Link expired</h1>
            <p className="text-text-secondary text-sm mb-8">
              This reset link is invalid or has expired. Request a new one.
            </p>
            <Button variant="primary" size="lg" className="w-full" onClick={() => router.push("/forgot-password")}>
              Request a new link
            </Button>
          </div>
        ) : done ? (
          <div className="text-center">
            <h1 className="font-display text-2xl mb-2 text-balance">Password updated</h1>
            <p className="text-text-secondary text-sm">Redirecting you to sign in…</p>
          </div>
        ) : (
          <>
            <h1 className="font-display text-2xl text-center mb-2 text-balance">
              Set a new password
            </h1>
            <p className="text-text-secondary text-center text-sm mb-8">
              At least 10 characters, including one special character.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs uppercase tracking-wide text-text-secondary mb-1.5">
                  New password
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-sm bg-base border border-interactive text-text-primary text-[15px] focus:border-gold-500/60 outline-none transition-colors ease-premium"
                  placeholder="••••••••••"
                />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wide text-text-secondary mb-1.5">
                  Confirm password
                </label>
                <input
                  type="password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-sm bg-base border border-interactive text-text-primary text-[15px] focus:border-gold-500/60 outline-none transition-colors ease-premium"
                  placeholder="••••••••••"
                />
              </div>

              {error && (
                <p className="text-sm text-danger" role="alert">
                  {error}
                </p>
              )}

              <Button type="submit" variant="primary" size="lg" disabled={loading} className="w-full">
                {loading ? "Updating…" : "Update password"}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

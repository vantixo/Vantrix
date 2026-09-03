import { Suspense } from "react";
import { MfaVerifyForm } from "./mfa-verify-form";

/**
 * The step-up screen a password-verified (aal1) session lands on when
 * the account has a verified TOTP factor requiring aal2 — reached either
 * straight from login-form.tsx right after signInWithPassword(), or via
 * (app)/layout.tsx's server-side redirect for anyone who lands on a
 * protected route without having stepped up yet (e.g. an old tab, a
 * bookmarked deep link). Both paths converge here; the form itself
 * re-checks AAL on mount so a direct visit with nothing to verify (or an
 * already-aal2 session) just bounces onward instead of showing a
 * pointless code prompt.
 */
export default function LoginVerifyPage() {
  return (
    <div className="relative min-h-screen bg-base flex items-center justify-center px-6 py-12">
      <Suspense fallback={null}>
        <MfaVerifyForm />
      </Suspense>
    </div>
  );
}

import { Suspense } from "react";
import { SafeImage as Image } from "@/components/ui/safe-image";
import { getLoginPortraits } from "@/lib/config/login-portraits";
import { LoginForm } from "./login-form";

/**
 * LOGIN-PORTRAITS-WIRE-FIX: the portrait collage described in this
 * config's own backend (20261016_seed_login_portraits_config.sql,
 * /admin/login-portraits, GET /api/config/login-portraits) referenced a
 * src/app/auth/login/page.tsx that no longer exists — the login route
 * moved to /login at some point and the portrait UI was never carried
 * over, leaving a fully-built, admin-editable backend with no consumer.
 * This is that consumer.
 *
 * Server Component (no "use client") so the portraits — the largest,
 * most visually important content on the one page every signed-out
 * visitor has to load — are fetched during render with zero client-side
 * request, no loading flash, and are eligible for `priority` (real LCP
 * candidates, not an afterthought fetched post-hydration). The form
 * itself stays a separate client component (./login-form) since it needs
 * useSearchParams/useState/the Supabase browser client; only it needs the
 * Suspense boundary useSearchParams requires.
 *
 * Layout mirrors the migration's own documented intent: a fixed 2x2
 * collage on desktop (side panel, first 4 portraits), and portraits[0]
 * doubling as a blurred full-bleed backdrop on mobile where there's no
 * room for a second panel.
 */
export default async function LoginPage() {
  const portraits = await getLoginPortraits();
  const backdrop = portraits[0];
  const gridPortraits = portraits.slice(0, 4);

  return (
    <div className="relative min-h-screen bg-base flex">
      {backdrop && (
        <div className="absolute inset-0 md:hidden" aria-hidden="true">
          <Image
            src={backdrop.src}
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover scale-110 blur-2xl opacity-30"
          />
          <div className="absolute inset-0 bg-base/85" />
        </div>
      )}

      {gridPortraits.length > 0 && (
        <div
          className="relative hidden md:grid w-1/2 grid-cols-2 grid-rows-2 gap-0.5"
          aria-hidden="true"
        >
          {gridPortraits.map((portrait, i) => (
            <div key={portrait.src} className="relative overflow-hidden bg-base">
              <Image
                src={portrait.src}
                alt=""
                fill
                priority={i < 2}
                sizes="25vw"
                className="object-cover"
              />
            </div>
          ))}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-base pointer-events-none" />
        </div>
      )}

      <div className="relative flex-1 flex items-center justify-center px-6 py-12">
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}

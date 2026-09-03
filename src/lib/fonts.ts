import localFont from "next/font/local";

/**
 * Shared display face for every "premium surface" — auth, the emotional-peak
 * paywall, onboarding. Import this one instance everywhere rather than
 * declaring a font loader again per-file: same variable, same subset, one
 * font, and it guarantees every surface actually matches instead of
 * drifting to slightly different weights over time.
 *
 * Loaded via next/font/local (self-hosted files in ./src/fonts) rather than
 * next/font/google. The Google loader fetches font files from Google's
 * servers during `next build`/`next dev`; on a network-restricted build
 * host (sandboxed CI, offline dev containers, egress firewalls that don't
 * allow fonts.gstatic.com) that fetch fails and — because it happens inside
 * the Next.js font SWC transform, not app code — takes the whole build down.
 * Self-hosting removes the network dependency entirely, in every
 * environment, with no env var or branching needed.
 *
 * Fraunces is a variable font, so one file covers the whole weight range
 * (100-900) instead of needing a separate file per static weight.
 */
export const display = localFont({
  src: [
    {
      path: "../fonts/Fraunces.ttf",
      style: "normal",
      weight: "100 900",
    },
    {
      path: "../fonts/Fraunces-Italic.ttf",
      style: "italic",
      weight: "100 900",
    },
  ],
  variable: "--font-display",
  // Serif fallback so text doesn't reflow/jump while Fraunces loads.
  fallback: ["Georgia", "Cambria", "Times New Roman", "serif"],
});

/**
 * Body / UI face for the black & gold theme (FRONTEND_DIRECTIVE §1, §8).
 * Manrope is a geometric grotesque with a wide weight range in one
 * variable file — used for nav, buttons, body copy, and numeric stats
 * (its tabular-leaning figures keep stat strips from jittering in width).
 * Self-hosted for the same reason as `display` above: no network
 * dependency at build time.
 */
export const sans = localFont({
  src: "../fonts/Manrope.ttf",
  variable: "--font-sans",
  weight: "200 800",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "sans-serif"],
});

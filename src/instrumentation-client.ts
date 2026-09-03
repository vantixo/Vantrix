/**
 * Client-side Sentry init.
 *
 * Counterpart to instrumentation.ts (server + edge runtimes). Next.js
 * 15.3+ auto-loads this file for the browser bundle the same way it loads
 * instrumentation.ts for the server — no manual import anywhere is
 * needed, it just has to exist at src/instrumentation-client.ts.
 *
 * Routed through /monitoring-tunnel (see that route's own comment) so ad
 * blockers that block *.sentry.io / *.ingest.us.sentry.io don't silently
 * drop every client error report — the browser's own network tab would
 * otherwise show 100% delivery while Sentry received nothing.
 */

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: process.env.NODE_ENV === "production" && !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  release: process.env.NEXT_PUBLIC_APP_VERSION,
  tunnel: "/monitoring-tunnel",

  // Keep client trace volume low — this is a per-pageview cost across
  // every visitor, not just error paths. Matches the 0.05 sample rate
  // instrumentation.ts already uses server-side in production.
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.05 : 1.0,

  // Same 4xx-downgrade rule as instrumentation.ts's server beforeSend —
  // a 404/expired-session isn't an application error, keep it out of the
  // "error" bucket that pages people, but still capture it for volume/
  // trend visibility.
  beforeSend(event, hint) {
    const err = hint.originalException as { statusCode?: number } | null;
    if (err?.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      if (err.statusCode !== 401 && err.statusCode !== 403) {
        event.level = "warning";
      }
    }
    return event;
  },
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

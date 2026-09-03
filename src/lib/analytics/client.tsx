"use client";

/**
 * Client-side product analytics — PostHog browser SDK.
 *
 * Counterpart to ./server.ts (server.ts's own header comment already
 * pointed here: "posthog.identify() client-side — see ./client.tsx" —
 * this is that file). Both are typed against the same AnalyticsEventMap
 * in ./events.ts so a client and a server event can never drift out of
 * sync on property shape.
 *
 * Fail-open, same posture as server.ts and lib/flags: a missing
 * NEXT_PUBLIC_POSTHOG_KEY, an ad blocker, or a PostHog outage must never
 * throw or block rendering — capture() and identifyUser() below are
 * no-ops whenever the client isn't initialized.
 */

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { AnalyticsEventMap, AnalyticsEventName } from "./events";

let initialized = false;
let posthogModule: typeof import("posthog-js").default | null = null;
let initPromise: Promise<void> | null = null;

/**
 * PERF (2026-08-26, whole-app pass): posthog-js used to be a static
 * top-level import here — this file is mounted once in the root layout
 * (AnalyticsPageview) and used from 6 call sites app-wide, so its full
 * bundle (commonly 40-90kB) was part of the ~186kB "shared by all"
 * First Load JS every single page pays before becoming interactive, for
 * a library that has nothing to do with a page's actual content or
 * interactivity. posthog-js is fire-and-forget by nature — nothing in
 * this app awaits capture()/identifyUser()'s return value or blocks
 * render on analytics — so a dynamic import here (PostHog's own
 * Next.js/App Router guide documents this same pattern) moves that
 * weight off the initial bundle and lets it load after the page is
 * already interactive, with zero change to any call site's signature or
 * this file's existing fail-open posture.
 */
function ensureInit(): Promise<void> {
  if (initialized || typeof window === "undefined") return Promise.resolve();
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return Promise.resolve(); // analytics disabled — no key configured for this deploy
  if (initPromise) return initPromise;

  initPromise = import("posthog-js")
    .then(({ default: posthog }) => {
      posthog.init(key, {
        api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
        // Manual pageview capture (see PostHogPageview below) — Vantrix routes
        // are all client-navigated app-shell pages, so we want pageviews tied
        // to the App Router's actual route changes, not PostHog's default
        // History API guess, which can double-fire or miss on Next's
        // client-side transitions.
        capture_pageview: false,
        // Session replay/autocapture stay off by default — this app's chat
        // and character-builder surfaces contain user-authored and
        // sometimes sensitive text; opt into replay deliberately per-surface
        // later rather than recording everything by default.
        disable_session_recording: true,
        autocapture: false,
        persistence: "localStorage+cookie",
      });
      posthogModule = posthog;
      initialized = true;
    })
    .catch(() => {
      // Fail open — a network hiccup fetching the chunk, or an ad
      // blocker intercepting the posthog-js request, must never throw or
      // block rendering. Matches this file's existing posture; initPromise
      // is intentionally left settled (rejected) rather than reset, so a
      // persistently blocked request doesn't retry-storm on every
      // capture() call for the rest of the session.
    });
  return initPromise;
}

/**
 * Capture a client-side analytics event. Typed against the same registry
 * server-side captureEvent() uses — see events.ts. Safe to call before
 * init resolves or when analytics is disabled; both are silent no-ops.
 */
export function capture<E extends AnalyticsEventName>(
  event: E,
  properties: AnalyticsEventMap[E]
): void {
  void ensureInit().then(() => {
    if (!initialized || !posthogModule) return;
    try {
      posthogModule.capture(event, properties);
    } catch {
      // Never let a broken analytics call surface to the user — matches
      // server.ts's fail-open posture.
    }
  });
}

/**
 * Ties the current browser session to a logged-in user. `userId` should
 * be the same Supabase user id passed as `distinctId` to server-side
 * captureEvent() (see server.ts's own comment) so client and server
 * events merge onto one PostHog person instead of splitting into two
 * disconnected timelines. Call once per session, e.g. from
 * <AnalyticsIdentify /> mounted in the authenticated app shell.
 */
export function identifyUser(userId: string, properties?: Record<string, unknown>): void {
  void ensureInit().then(() => {
    if (!initialized || !posthogModule) return;
    try {
      posthogModule.identify(userId, properties);
    } catch {
      // Fail open — see capture() above.
    }
  });
}

export function resetIdentity(): void {
  if (!initialized || !posthogModule) return;
  try {
    posthogModule.reset();
  } catch {
    // Fail open.
  }
}

/**
 * Mounted once in the authenticated app shell layout. Ties every event
 * in this browser session to the current user id — split out from
 * AnalyticsPageview below so an unauthenticated page (login, marketing)
 * can still get pageview tracking without ever calling identify().
 */
export function AnalyticsIdentify({ userId }: { userId: string }) {
  useEffect(() => {
    identifyUser(userId);
  }, [userId]);
  return null;
}

/**
 * Fires a $pageview on every App Router navigation. Reads pathname +
 * search params directly rather than listening for a History API event —
 * Next's client router doesn't dispatch one on soft navigation, so this
 * is the only reliable hook point (same approach PostHog's own Next.js
 * integration guide recommends for the App Router).
 */
export function AnalyticsPageview() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!pathname) return;
    const query = searchParams?.toString();
    const url = query ? `${pathname}?${query}` : pathname;
    void ensureInit().then(() => {
      if (!initialized || !posthogModule) return;
      try {
        posthogModule.capture("$pageview", { $current_url: url });
      } catch {
        // Fail open.
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams]);

  return null;
}

"use client";

import { useEffect } from "react";

/**
 * Registers /sw.js on mount. Split into its own client component (rather
 * than inlining a <script> or useEffect in the server RootLayout) so the
 * server layout stays a server component — this is the only piece of
 * layout.tsx that needs the browser.
 *
 * Renders nothing. Registration failures are swallowed on purpose: a
 * failed SW registration should degrade to "push notifications
 * unavailable" (usePushSubscription already reports that via its
 * "unsupported" status) rather than surfacing an error to every visitor,
 * most of whom never touch push.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Swallowed — see file header.
    });
  }, []);

  return null;
}

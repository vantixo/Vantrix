"use client";

/**
 * Forces a clean slate for the service worker + its caches. There's no
 * automatic call site by default — this is a deliberate escape hatch for
 * two situations:
 *
 *   1. Logout, if a future change ever lets sw.js cache anything
 *      user-specific (it doesn't today — see sw.js's own comment — but
 *      this exists so that guarantee has a simple way to be enforced
 *      without a server round-trip).
 *   2. A support/debug affordance ("having issues? clear app data") that
 *      doesn't require the user to know how to open devtools.
 *
 * Safe to call even if no service worker was ever registered — every
 * step below is a no-op in that case.
 */
export async function clearServiceWorkerCaches(): Promise<void> {
  if (typeof window === "undefined") return;

  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }

  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((reg) => reg.unregister()));
  }
}

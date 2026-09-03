/**
 * Vantrix service worker.
 *
 * Scope is deliberately narrow: this exists to satisfy
 * `navigator.serviceWorker.ready` for Web Push (use-push-subscription.ts
 * calls `pushManager.subscribe()` off the active registration — without a
 * registered worker that call has nothing to attach to) and to display
 * incoming push notifications. It is NOT an offline-first asset cache —
 * this app is a dynamic, auth-gated Supabase-backed shell, and caching
 * HTML/API responses here would risk serving stale/wrong-user data. If
 * true offline support is wanted later, add a narrowly-scoped
 * runtime cache for static assets only (fonts, icons), not routes.
 *
 * CACHE_VERSION exists only so clear-caches.ts (src/lib/pwa/clear-caches.ts)
 * has something deterministic to delete when the app wants to force a
 * clean slate (e.g. after a logout, or a breaking client update).
 */

const CACHE_VERSION = "vantrix-sw-v1";

self.addEventListener("install", () => {
  // Activate immediately rather than waiting for all tabs to close —
  // this worker has no cached assets to be careful about serving stale.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

/**
 * Push payloads are JSON-encoded by lib/push/* server-side (see
 * push/subscribe route + whatever calls web-push's sendNotification) as
 * { title, body, url, icon? }. Falls back to a generic notification if
 * the payload is missing or malformed rather than dropping the push
 * silently — a push with no visible notification can get the origin's
 * push permission revoked by the browser.
 */
self.addEventListener("push", (event) => {
  let payload = { title: "Vantrix", body: "You have a new notification.", url: "/notifications" };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // Non-JSON push data — keep the fallback payload above.
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: payload.icon || "/icons/icon-192.png",
      badge: "/icons/icon-128.png",
      data: { url: payload.url || "/notifications" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/notifications";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = allClients.find((c) => new URL(c.url).pathname === targetUrl);
      if (existing) {
        existing.focus();
        return;
      }
      const matchingOrigin = allClients.find((c) => c.url.startsWith(self.location.origin));
      if (matchingOrigin) {
        matchingOrigin.focus();
        matchingOrigin.navigate(targetUrl);
        return;
      }
      await self.clients.openWindow(targetUrl);
    })()
  );
});

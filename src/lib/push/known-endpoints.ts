/**
 * src/lib/push/known-endpoints.ts
 *
 * Hardening: `PushSubscription.endpoint` is client-supplied. A generic
 * `z.string().url()` check lets a malicious client register ANY URL —
 * including internal/private addresses (169.254.169.254 cloud metadata,
 * localhost, RFC1918 ranges) — as a "push subscription". Since
 * send-push.ts later does a server-side POST to exactly that URL
 * (webpush.sendNotification → fetch), an unvalidated endpoint is a classic
 * SSRF vector: attacker registers `http://169.254.169.254/...`, waits for
 * a cron (nudges) to fire a push to them, and the server makes the request
 * on the attacker's behalf.
 *
 * Real browsers only ever hand back subscription endpoints on a small,
 * stable set of push-service hosts. Anything else is rejected outright at
 * subscribe time — cheaper and safer than trying to sanitize/deny individual
 * private IP ranges at send time.
 */

const ALLOWED_PUSH_HOSTS = new Set([
  // Chrome, Edge, Opera, Brave, Samsung Internet, Android WebView
  'fcm.googleapis.com',
  'android.googleapis.com',
  // Firefox
  'updates.push.services.mozilla.com',
  // Safari / iOS / macOS
  'web.push.apple.com',
  // Legacy Edge (pre-Chromium) — harmless to keep, effectively unused now
  'wns2-*.notify.windows.com',
]);

function hostMatchesAllowlist(host: string): boolean {
  const lower = host.toLowerCase();
  for (const pattern of ALLOWED_PUSH_HOSTS) {
    if (!pattern.includes('*')) {
      if (lower === pattern) return true;
      continue;
    }
    // Only wildcard in use is a single leading-segment glob (wns2-*...) —
    // deliberately not a general glob engine, to keep this trivially
    // auditable.
    const suffix = pattern.slice(pattern.indexOf('*') + 1);
    if (lower.endsWith(suffix)) return true;
  }
  return false;
}

/** True only for https:// URLs on a recognized browser push-service host. */
export function isKnownPushEndpoint(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  return hostMatchesAllowlist(url.hostname);
}

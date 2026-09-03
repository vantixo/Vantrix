/**
 * getClientIp — trusted-proxy-aware client IP extraction.
 *
 * WHY: Taking the FIRST x-forwarded-for entry is spoofable — any client can
 * inject "1.2.3.4, realip" in that header. The actual client IP is always the
 * LAST entry (proxies append; client cannot append after the proxy does).
 *
 * Precedence:
 *   1. x-real-ip  — set by Vercel/Nginx to the true client IP
 *   2. cf-connecting-ip — set by Cloudflare
 *   3. Last entry of x-forwarded-for (proxies append, so last = closest to origin)
 *   4. null (internal/trusted calls)
 *
 * TRUST MODEL (P2 fix): these headers are only meaningful if something
 * upstream of this process is *guaranteed* to overwrite them before the
 * request reaches us. On Vercel that's always true. On a self-hosted
 * docker-compose deployment it is only true if you're actually behind a
 * reverse proxy configured to strip/overwrite them — otherwise any client
 * can set x-real-ip directly and forge an arbitrary IP, defeating IP-based
 * rate limiting. `TRUST_PROXY_HEADERS` makes that assumption explicit
 * instead of silently trusting client-supplied headers on self-hosted
 * deploys. Vercel deployments (process.env.VERCEL is set by the platform)
 * are always trusted automatically.
 */
import type { NextRequest } from 'next/server';

function proxyHeadersAreTrusted(): boolean {
  // Vercel's own edge network always overwrites these headers itself.
  if (process.env.VERCEL) return true;
  // Self-hosted: only trust them if the operator has explicitly confirmed
  // there's a reverse proxy in front that overwrites these headers.
  return process.env.TRUST_PROXY_HEADERS === 'true';
}

export function getClientIp(req: NextRequest): string | null {
  if (!proxyHeadersAreTrusted()) {
    // No trusted proxy confirmed to be stripping/overwriting these headers
    // -> treat them as attacker-controlled and don't use them for anything
    // security-sensitive (rate limiting, audit logs, etc). Callers should
    // fall back to user/session-based limiting in this mode.
    return null;
  }

  // Vercel sets x-real-ip to the true client IP
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp.trim();

  // Cloudflare
  const cfIp = req.headers.get('cf-connecting-ip');
  if (cfIp) return cfIp.trim();

  // Fallback: LAST entry of x-forwarded-for — proxies append, so last = real client
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',').at(-1)?.trim() ?? null;

  return null;
}

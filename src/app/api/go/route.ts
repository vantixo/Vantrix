/**
 * GET /api/go — Hardened outbound-link router
 *
 * Every external link in the app that points at a DB-driven or otherwise
 * untrusted destination (currently: ad links) should route through here
 * instead of using `<a href={rawValue}>` directly. Statically-known,
 * developer-authored URLs (Discord, Telegram, socials in the footer) do not
 * need this — they're trusted at build time — but anything that came out of
 * the database goes through this route.
 *
 * What this buys you over a plain <a href>:
 *   1. Scheme allowlist (http/https only) enforced server-side, independent
 *      of whatever validation ran at write time — defense in depth against
 *      a bad DB row (compromised admin session, direct DB edit, migration
 *      bug) ever reaching a user's browser as a clickable javascript:/data:
 *      URI. See isSafeExternalUrl() in @/lib/security.edge for why
 *      z.string().url() alone does not guarantee this.
 *   2. Click tracking that can't be lost. The previous pattern (client fires
 *      a fetch() to /api/ads/track in an onClick handler, in parallel with
 *      the browser navigating) works most of the time because target=_blank
 *      keeps the origin tab alive, but it's still a best-effort, cancellable
 *      side channel. Routing the click itself through the server means the
 *      increment happens before the redirect is issued, unconditionally.
 *   3. One place to extend later — rate limiting outbound clicks, per-ad
 *      geo/region gating, adding UTM params, etc. — without touching every
 *      component that renders an external link.
 *
 * Usage: <a href={`/api/go?url=${encodeURIComponent(ad.link)}&adId=${ad.id}`}>
 */

import { NextRequest, NextResponse } from 'next/server';
import { z }                         from 'zod';
import { Ratelimit }                 from '@upstash/ratelimit';
import { supabaseAdmin }             from '@/lib/supabase/admin';
import { redis }                     from '@/lib/redis';
import { isSafeExternalUrl }         from '@/lib/security.edge';
import { getClientIp }               from '@/lib/network/get-client-ip';
import { logger }                    from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const runtime  = 'edge';

// Same generous ceiling as /api/ads/track — this endpoint is a superset of
// that click-tracking traffic (plus organic footer/social clicks later),
// so it shouldn't be stricter than the thing it's replacing.
const goLimiter = new Ratelimit({
  redis,
  limiter:   Ratelimit.slidingWindow(100, '1 m'),
  prefix:    'rl:go',
  analytics: false,
});

const querySchema = z.object({
  url:  z.string().url(),
  adId: z.string().uuid().optional(),
});

// Generic, safe fallback destination for anything that fails validation —
// never redirect to an unvalidated location, and never render the rejected
// URL back into the response body (reflected-XSS surface).
const FALLBACK_REDIRECT = '/';

export async function GET(req: NextRequest) {
  // BUG FIX (2026-08-08): getClientIp() returning null (no proxy header
  // present — e.g. a bare `next start` with no reverse proxy in front) used
  // to fall back to a hardcoded "127.0.0.1", making every client on a
  // deployment without proxy headers share one rate-limit bucket instead of
  // getting their own. Skip limiting when we can't tell clients apart —
  // punishing everyone identically isn't real abuse protection anyway.
  const ip = getClientIp(req);
  if (ip !== null) {
    const { success } = await goLimiter.limit(ip);
    if (!success) {
      return NextResponse.redirect(new URL(FALLBACK_REDIRECT, req.url), { status: 302 });
    }
  }

  const parsed = querySchema.safeParse({
    url:  req.nextUrl.searchParams.get('url'),
    adId: req.nextUrl.searchParams.get('adId') ?? undefined,
  });

  if (!parsed.success || !isSafeExternalUrl(parsed.data.url)) {
    logger.warn('go: rejected unsafe or malformed redirect target', {
      hasUrl: !!req.nextUrl.searchParams.get('url'),
    });
    return NextResponse.redirect(new URL(FALLBACK_REDIRECT, req.url), { status: 302 });
  }

  const { url, adId } = parsed.data;

  if (adId) {
    // Fire-and-forget from the route's perspective, but unlike the old
    // client-side onClick fetch, this runs server-side before the redirect
    // is returned — not racing page unload.
    supabaseAdmin
      .rpc('increment_ad_stat', { p_ad_id: adId, p_column: 'clicks' })
      .then(({ error }) => {
        if (error) logger.warn('go: click increment failed', { adId, error: error.message });
      });
  }

  return NextResponse.redirect(url, { status: 302 });
}

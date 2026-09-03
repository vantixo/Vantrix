/**
 * POST /api/push/subscribe
 *
 * Registers (or refreshes) a browser's Web Push subscription for the
 * signed-in user. Called from the client right after a successful
 * `pushManager.subscribe()` — see src/components/pwa/push-opt-in.tsx.
 *
 * Upserts on `endpoint` (the push service's own unique-per-device key), so
 * re-subscribing the same browser (e.g. after clearing the permission and
 * re-granting it) just refreshes keys/last_seen_at instead of creating a
 * duplicate row that would receive doubled notifications.
 *
 * Hardening:
 *   - endpoint must resolve to a known browser push-service host (see
 *     known-endpoints.ts) — closes an SSRF vector where a malicious client
 *     registers an arbitrary URL and waits for the server to POST to it.
 *   - rate-limited per user (shared 30 req/min limiter) — this is a cheap
 *     endpoint but still a DB write, no reason to let it be hammered.
 *   - capped at MAX_SUBSCRIPTIONS_PER_USER active devices; oldest
 *     (by last_seen_at) is evicted to make room rather than letting an
 *     account accumulate unbounded rows (each active subscription costs a
 *     real push-service request on every send).
 */
import { NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { ratelimit } from '@/lib/rate-limit';
import { isKnownPushEndpoint } from '@/lib/push/known-endpoints';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const MAX_SUBSCRIPTIONS_PER_USER = 8;

const subscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512),
  }),
  userAgent: z.string().max(300).optional(),
});

export async function POST(req: Request) {
  const { user } = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { success: rlOk } = await ratelimit.limit(`push-subscribe:${user.id}`);
  if (!rlOk) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = subscribeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid subscription payload', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { endpoint, keys, userAgent } = parsed.data;

  if (!isKnownPushEndpoint(endpoint)) {
    logger.warn('push:subscribe:rejected-endpoint', { userId: user.id, endpoint });
    return NextResponse.json({ error: 'Unrecognized push endpoint' }, { status: 400 });
  }

  // Enforce the per-user device cap BEFORE the upsert: if this endpoint is
  // already one of the user's rows, the upsert below is a no-op count-wise
  // and the cap check is unnecessary/harmless; if it's a genuinely new
  // device past the cap, evict the least-recently-seen one first so the
  // upsert never needs to be rolled back.
  const { data: existing, error: listErr } = await supabaseAdmin
    .from('push_subscriptions')
    .select('id, endpoint, last_seen_at')
    .eq('user_id', user.id)
    .order('last_seen_at', { ascending: true });

  if (listErr) {
    logger.error('push:subscribe:list-failed', { userId: user.id, error: listErr.message });
    return NextResponse.json({ error: 'Failed to save subscription' }, { status: 500 });
  }

  const isNewDevice = !existing?.some((row) => row.endpoint === endpoint);
  if (isNewDevice && (existing?.length ?? 0) >= MAX_SUBSCRIPTIONS_PER_USER) {
    const toEvict = existing!.slice(0, existing!.length - MAX_SUBSCRIPTIONS_PER_USER + 1);
    await supabaseAdmin
      .from('push_subscriptions')
      .delete()
      .in('id', toEvict.map((row) => row.id));
  }

  const { error } = await supabaseAdmin
    .from('push_subscriptions')
    .upsert(
      {
        user_id: user.id,
        endpoint,
        p256dh: keys.p256dh,
        auth_key: keys.auth,
        user_agent: userAgent ?? null,
        last_seen_at: new Date().toISOString(),
        invalid_at: null, // re-subscribing clears any prior invalidation
      },
      { onConflict: 'endpoint' },
    );

  if (error) {
    logger.error('push:subscribe:failed', { userId: user.id, error: error.message });
    return NextResponse.json({ error: 'Failed to save subscription' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}


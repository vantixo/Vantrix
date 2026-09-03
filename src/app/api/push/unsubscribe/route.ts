/**
 * POST /api/push/unsubscribe
 *
 * Removes a device's Web Push subscription — called when the user turns
 * push off in Settings, or opportunistically when the client notices
 * `pushManager.getSubscription()` is gone (permission revoked outside the
 * app). Deletes rather than soft-invalidates: this is a real user action,
 * not a delivery failure, so there's no reason to keep the row around.
 */
import { NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { ratelimit } from '@/lib/rate-limit';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const unsubscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
});

export async function POST(req: Request) {
  const { user } = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { success: rlOk } = await ratelimit.limit(`push-unsubscribe:${user.id}`);
  if (!rlOk) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = unsubscribeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Scoped to the owning user_id too — not just the endpoint — so one
  // user can never delete another's subscription row by guessing/replaying
  // an endpoint URL.
  const { error } = await supabaseAdmin
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', parsed.data.endpoint)
    .eq('user_id', user.id);

  if (error) {
    logger.error('push:unsubscribe:failed', { userId: user.id, error: error.message });
    return NextResponse.json({ error: 'Failed to remove subscription' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

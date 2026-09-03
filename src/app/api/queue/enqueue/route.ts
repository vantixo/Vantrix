/**
 * POST /api/queue/enqueue
 *
 * Enqueues a chat job for async processing. Used during traffic spikes
 * when direct synchronous processing would exceed concurrency limits.
 *
 * Returns a jobId for polling via /api/queue/status/[jobId].
 *
 * Flow:
 *   Client → POST /api/queue/enqueue → { jobId }
 *   Client polls GET /api/queue/status/[jobId] until status === 'done'
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { z }                         from 'zod';
import { resolveEffectiveTier,
         checkChatLimit,
         checkDailyMessageCap,
         checkPerCharacterMessageCap,
         checkCharacterTierAccess,
         type Tier }                 from '@/lib/rate-limit';
import { checkMatureContentAccess }  from '@/lib/access/character-gate';
import { isUserSuspended }           from '@/lib/ai/anomaly-detector';
import { enqueueChatJob }            from '@/lib/queue';
import { toErrorBody }               from '@/lib/errors';
import { supabaseAdmin }             from '@/lib/supabase/admin';
import { readBodyWithLimit, checkDeduplication, dedupKey, hashBody } from '@/lib/security';

export const dynamic = 'force-dynamic';

const schema = z.object({
  message:        z.string().min(1).max(4000),
  characterId:    z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  // Dating mode fields — mirroring the direct /api/chat schema so both paths
  // receive an identical prompt context. Previously omitted, causing TypeScript
  // errors and a missing datingMode field on the ChatJob interface.
  datingMode:     z.boolean().optional().default(false),
  matchId:        z.string().uuid().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await getAuthedUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    }

    // This route is /api/chat/stream's own fallback path (see QUOTA PARITY
    // FIX note below), so it must mirror every gate the sync route enforces —
    // including the anomaly-suspension check — or a suspended user could
    // route around the suspension simply by hitting a 503 first.
    if (await isUserSuspended(user.id)) {
      return NextResponse.json(
        { error: 'Your account has been temporarily suspended for unusual usage patterns. Contact support if you believe this is an error.', code: 'ACCOUNT_SUSPENDED' },
        { status: 403 },
      );
    }

    // BODY-LIMIT PARITY FIX: this route previously read the body via the
    // unbounded req.json(), unlike /api/chat/stream's readBodyWithLimit —
    // a large payload here allocates memory before zod ever gets a chance
    // to reject it on length. This route is reachable directly (not only
    // as the stream route's fallback), so it needs the same guard.
    const bodyResult = await readBodyWithLimit(req, 8 * 1024);
    if (!bodyResult.ok) {
      return NextResponse.json(
        { error: bodyResult.reason === 'too_large' ? 'Request body too large' : 'Invalid request body', code: 'VALIDATION_ERROR' },
        { status: bodyResult.reason === 'too_large' ? 413 : 400 },
      );
    }
    const parsed = schema.safeParse(bodyResult.body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    // DEDUP-PARITY FIX: /api/chat/stream rejects an identical
    // (userId, message, characterId, conversationId) submission within a
    // 5s window; this route — directly callable, and also the fallback
    // use-chat.ts's sendMessage calls into after a network drop — had no
    // such guard, so a double-click, a client retry, or the fallback firing
    // twice could enqueue (and bill for) the same turn more than once.
    const dupKey = dedupKey(user.id, hashBody({
      message: parsed.data.message, characterId: parsed.data.characterId, conversationId: parsed.data.conversationId,
    }));
    if (await checkDeduplication(dupKey)) {
      return NextResponse.json({ error: 'Duplicate request', code: 'DUPLICATE_REQUEST' }, { status: 409 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('tier,role,is_admin')
      .eq('id', user.id)
      .single();

    const tier = resolveEffectiveTier(profile ?? {});

    // QUOTA PARITY FIX: this endpoint is the fallback /api/chat/stream calls
    // itself into on a 503/5xx or network failure — i.e. exactly the traffic
    // conditions the daily/per-character/rate caps most need to hold under.
    // Previously this route enforced only auth + the premium-character gate,
    // so a user who had already exhausted checkChatLimit / checkDailyMessageCap /
    // checkPerCharacterMessageCap on the sync route could still get replies
    // indefinitely through this path, one job at a time, capped only by the
    // per-user in-flight *concurrency* guard in enqueueChatJob (which resets
    // the moment each job completes and says nothing about daily volume).
    // Mirrors the sync route's check order and response shape (code/status)
    // exactly, so use-chat.ts's existing isUpgradeGate branching — which
    // already special-cases DAILY_LIMIT_EXCEEDED / RATE_LIMIT_EXCEEDED /
    // PER_CHARACTER_LIMIT_EXCEEDED — now covers this path too, instead of
    // those gates only ever being reachable via /api/chat/stream.
    const rateLimit = await checkChatLimit(user.id, tier);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', code: 'RATE_LIMIT_EXCEEDED', rateLimit },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil((rateLimit.reset - Date.now()) / 1000)) },
        },
      );
    }

    // QUOTA-INTEGRITY FIX (parity with /api/chat/stream's identical fix):
    // checkDailyMessageCap/checkPerCharacterMessageCap increment their Redis
    // counters as part of the check itself. They used to run before the
    // character was fetched below — a request against a deleted or
    // tier/NSFW-gated character burned one of the user's daily and
    // per-character messages for a reply that would never arrive. Moved the
    // character fetch + tier/mature gates ahead of both counter increments.
    const { data: character } = await supabaseAdmin
      .from('characters')
      .select('id,is_premium,min_tier,is_nsfw')
      .eq('id', parsed.data.characterId)
      .maybeSingle();
    if (!character) {
      return NextResponse.json({ error: 'Character not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    const premiumGate = checkCharacterTierAccess(
      tier,
      character.min_tier as Tier | null | undefined,
      !!character.is_premium,
    );
    if (!premiumGate.allowed) {
      return NextResponse.json(
        { error: premiumGate.reason ?? 'This character requires a paid plan', code: 'PREMIUM_CHARACTER_REQUIRED' },
        { status: 403 },
      );
    }

    const matureGate = await checkMatureContentAccess(user.id, !!character.is_nsfw, tier);
    if (!matureGate.allowed) {
      return NextResponse.json(
        { error: matureGate.reason ?? 'This character has mature content enabled', code: 'MATURE_CONTENT_GATE' },
        { status: 403 },
      );
    }

    const dailyCap = await checkDailyMessageCap(user.id, tier);
    if (!dailyCap.allowed) {
      return NextResponse.json(
        {
          error:   'daily_message_cap_exceeded',
          message: `You've hit your daily message limit for the ${tier} plan.`,
          used:    dailyCap.used,
          limit:   dailyCap.limit,
          code:    'DAILY_LIMIT_EXCEEDED',
          upgrade: tier === 'free' ? 'Upgrade to Spark for more messages/day' : undefined,
        },
        { status: 429 },
      );
    }

    const perCharCap = await checkPerCharacterMessageCap(user.id, parsed.data.characterId, tier);
    if (!perCharCap.allowed) {
      return NextResponse.json(
        {
          error:   'per_character_message_cap_exceeded',
          message: `You've reached the ${perCharCap.limit}-message limit for this character today.`,
          used:    perCharCap.used,
          limit:   perCharCap.limit,
          code:    'PER_CHARACTER_LIMIT_EXCEEDED',
          upgrade: tier === 'free' ? 'Upgrade to Spark to remove the per-character cap' : undefined,
        },
        { status: 429 },
      );
    }

    // Thread the originating X-Request-ID so the worker trace can be linked
    // back to this enqueue request for end-to-end incident investigation.
    const originTraceId = req.headers.get('x-request-id') ?? undefined;

    const result = await enqueueChatJob({
      userId:         user.id,
      characterId:    parsed.data.characterId,
      conversationId: parsed.data.conversationId,
      message:        parsed.data.message,
      tier,
      datingMode:     parsed.data.datingMode,
      matchId:        parsed.data.matchId,
      originTraceId,
    });

    if (!result.queued) {
      return NextResponse.json(
        { error: result.error ?? 'Queue unavailable', code: 'QUEUE_FULL' },
        { status: 503 },
      );
    }

    return NextResponse.json({ jobId: result.jobId, depth: result.depth, status: 'pending' }, { status: 202 });
  } catch (err) {
    return NextResponse.json(toErrorBody(err), { status: 500 });
  }
}

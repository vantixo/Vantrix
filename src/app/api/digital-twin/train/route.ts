/**
 * POST /api/digital-twin/train
 *
 * Kicks off auto-learning: analyzes the caller's own sent messages across
 * their conversations and (re)builds their digital twin's style profile.
 * Body: { depth?: 'standard' | 'deep' | 'master' } — 'deep' pulls substantially
 * more history and infers a richer personality/values/humor profile; 'master'
 * is the top tier, reading up to ~5,000 messages/posts and inferring beliefs,
 * relationship style, decision-making, and speech rhythm on top of that — a
 * meaningfully slower, more expensive pass aimed at a twin that's supposed to
 * feel indistinguishable from the real person, not just a decent impression.
 * Elite-tier gated. Rate-limited to prevent repeat-click LLM cost abuse —
 * training is a real inference call, not a free read.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { requirePlan } from '@/lib/auth/plan';
import { buildStyleProfile, TRAINING_TOKEN_COST, TRAINING_ETA_SECONDS } from '@/lib/digital-twin/engine';
import { ratelimit } from '@/lib/rate-limit';
import { toErrorBody, errorLogFields } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isAdminProfile } from '@/lib/auth/admin';

export const dynamic = 'force-dynamic';
// Master training reads thousands of rows and runs a large, low-temperature
// completion — comfortably past the platform's default function timeout.
// Explicit maxDuration so a legitimate long-running master train doesn't
// get killed mid-request (the caller/UI already sets expectations via
// TRAINING_ETA_SECONDS that this can take upwards of a minute).
export const maxDuration = 300;

const bodySchema = z.object({
  depth: z.enum(['standard', 'deep', 'master']).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

    await requirePlan(user.id, 'premium', 'Digital Twin');

    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    const depth = parsed.success && parsed.data.depth ? parsed.data.depth : 'standard';
    const cost = TRAINING_TOKEN_COST[depth];

    // Training calls an LLM and reads a large batch of messages (up to
    // 1000+ for deep training) — cheap to abuse by spamming the button.
    // Same shared 30 req/min limiter used elsewhere, keyed per-user so it
    // doesn't affect other endpoints.
    const { success: rlOk } = await ratelimit.limit(`digital-twin-train:${user.id}`);
    if (!rlOk) {
      return NextResponse.json({ error: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED' }, { status: 429 });
    }

    // Deep training costs tokens (standard training remains free, covered
    // by the elite plan gate). Same admin-free-tier + upfront-check +
    // atomic-deduct pattern used by image generation / TTS / character
    // creation elsewhere in the app.
    if (cost > 0) {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('tokens,role,is_admin')
        .eq('id', user.id)
        .single();

      if (!isAdminProfile(profile) && (profile?.tokens ?? 0) < cost) {
        return NextResponse.json({
          error: `${depth === 'master' ? 'Master' : 'Deep'} training costs ${cost} tokens — you have ${profile?.tokens ?? 0}.`,
          code: 'INSUFFICIENT_TOKENS',
          tokensRequired: cost,
          tokensAvailable: profile?.tokens ?? 0,
        }, { status: 402 });
      }

      if (!isAdminProfile(profile)) {
        const { error: deductErr } = await supabaseAdmin.rpc('deduct_tokens', {
          p_user_id: user.id,
          p_amount: cost,
        });
        if (deductErr) {
          return NextResponse.json({
            error: 'Token deduction failed — please try again',
            code: 'TOKEN_DEDUCT_FAILED',
          }, { status: 500 });
        }
      }
    }

    const result = await buildStyleProfile(user.id, depth);

    if (result.status === 'insufficient_history') {
      return NextResponse.json({
        status: 'insufficient_history',
        messageCount: result.messageCount,
        error: `Need at least a bit more chat history to learn your style — you have ${result.messageCount} messages so far. Keep chatting and try again.`,
        code: 'INSUFFICIENT_HISTORY',
      }, { status: 400 });
    }

    return NextResponse.json({
      status: 'trained',
      messageCount: result.messageCount,
      depth,
      tokensSpent: cost,
      profile: result.profile,
      etaSeconds: TRAINING_ETA_SECONDS[depth],
    });
  } catch (err) {
    logger.error('digital-twin train error', errorLogFields(err));
    const status = err instanceof Error && 'statusCode' in err ? (err as { statusCode: number }).statusCode : 500;
    return NextResponse.json(toErrorBody(err), { status });
  }
}

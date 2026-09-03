/**
 * POST /api/roleplay/scenarios/[id]/vote
 * Body: { voteType: 'like' | 'dislike' }
 *
 * Atomically casts, switches, or clears the caller's like/dislike on a
 * roleplay scenario, mirroring /api/feed/posts/[id]/like's shape but for
 * two mutually-exclusive vote types. Uses the toggle_scenario_vote()
 * Postgres function (migration 20261102) which handles all three
 * transitions (none -> voted, voted -> switched, voted -> cleared) and
 * updates roleplay_scenarios.like_count/dislike_count in one transaction.
 *
 * Rate-limited: 30 req/min per user via Upstash Redis sliding window, same
 * budget as the post-like route.
 *
 * Returns: { vote: 'like' | 'dislike' | null, like_count: number, dislike_count: number }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { Ratelimit } from '@upstash/ratelimit';
import { toErrorBody, errorLogFields } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { redis } from '@/lib/redis';

export const dynamic = 'force-dynamic';

const scenarioVoteLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, '1 m'),
  prefix: 'vantrix:scenario-vote',
  analytics: false,
});

function isVoteResult(
  value: unknown,
): value is { vote: 'like' | 'dislike' | null; like_count: number; dislike_count: number } {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.vote === 'like' || v.vote === 'dislike' || v.vote === null) &&
    typeof v.like_count === 'number' &&
    typeof v.dislike_count === 'number'
  );
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const { user } = await getAuthedUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const scenarioId = params.id;
    if (!scenarioId) {
      return NextResponse.json({ error: 'Missing scenario id' }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    const voteType = body?.voteType;
    if (voteType !== 'like' && voteType !== 'dislike') {
      return NextResponse.json({ error: "voteType must be 'like' or 'dislike'" }, { status: 400 });
    }

    const { success } = await scenarioVoteLimiter.limit(user.id);
    if (!success) {
      return NextResponse.json(
        { error: 'Slow down — too many votes too fast' },
        { status: 429 },
      );
    }

    const { data, error } = await supabaseAdmin.rpc('toggle_scenario_vote', {
      p_scenario_id: scenarioId,
      p_user_id: user.id,
      p_vote_type: voteType,
    });

    if (error) {
      if (error.message.includes('Scenario not found')) {
        return NextResponse.json({ error: 'Scenario not found' }, { status: 404 });
      }
      logger.error('roleplay:scenario-vote-rpc-error', { scenarioId, userId: user.id, error: error.message });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!isVoteResult(data)) {
      logger.error('roleplay:scenario-vote-shape-error', { scenarioId, userId: user.id, data: JSON.stringify(data) });
      return NextResponse.json({ error: 'Unexpected response from vote toggle' }, { status: 500 });
    }

    return NextResponse.json(data);

  } catch (err) {
    logger.error('roleplay:scenario-vote-error', errorLogFields(err));
    return NextResponse.json(toErrorBody(err), { status: 500 });
  }
}

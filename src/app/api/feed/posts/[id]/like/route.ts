/**
 * POST /api/feed/posts/[id]/like
 *
 * Atomically toggles a like on a character post.
 * Uses the toggle_post_like() Postgres function (migration 20240101)
 * which inserts/deletes a row in the post_likes join table and updates
 * character_posts.likes_count in a single transaction.
 *
 * Rate-limited: 30 req/min per user via Upstash Redis sliding window.
 *
 * Returns: { liked: boolean, likes_count: number }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { supabaseAdmin }              from '@/lib/supabase/admin';
import { Ratelimit }                  from '@upstash/ratelimit';
import { toErrorBody, errorLogFields }                from '@/lib/errors';
import { logger }                     from '@/lib/logger';
import { redis }              from '@/lib/redis';

export const dynamic = 'force-dynamic';


// 30 likes per minute per user — prevent spam farming
const likeLimiter = new Ratelimit({
  redis,
  limiter:   Ratelimit.slidingWindow(30, '1 m'),
  prefix:    'vantrix:like',
  analytics: false,
});

/**
 * Runtime guard for the RPC's return value. The Postgres function is typed
 * as `Returns: { liked: boolean; likes_count: number }` in supabase.ts for
 * caller convenience, but PostgREST still hands it back over the wire as
 * untyped JSON — this confirms the shape actually matches before trusting it,
 * instead of asserting it with `as` and hoping.
 */
function isLikeResult(value: unknown): value is { liked: boolean; likes_count: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).liked === 'boolean' &&
    typeof (value as Record<string, unknown>).likes_count === 'number'
  );
}

export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const { user } = await getAuthedUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const postId = params.id;
    if (!postId) {
      return NextResponse.json({ error: 'Missing post id' }, { status: 400 });
    }

    // Rate limit — 30 likes/min per user
    const { success } = await likeLimiter.limit(user.id);
    if (!success) {
      return NextResponse.json(
        { error: 'Slow down — too many likes too fast' },
        { status: 429 }
      );
    }

    // Atomic like toggle via Postgres function
    const { data, error } = await supabaseAdmin.rpc('toggle_post_like', {
      p_post_id: postId,
      p_user_id: user.id,
    });

    if (error) {
      if (error.message.includes('Post not found')) {
        return NextResponse.json({ error: 'Post not found' }, { status: 404 });
      }
      logger.error('feed:like-rpc-error', { postId, userId: user.id, error: error.message });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!isLikeResult(data)) {
      logger.error('feed:like-rpc-shape-error', { postId, userId: user.id, data: JSON.stringify(data) });
      return NextResponse.json({ error: 'Unexpected response from like toggle' }, { status: 500 });
    }

    return NextResponse.json(data);

  } catch (err) {
    logger.error('feed:like-error', errorLogFields(err));
    return NextResponse.json(toErrorBody(err), { status: 500 });
  }
}

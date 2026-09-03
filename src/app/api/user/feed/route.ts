/**
 * GET /api/user/feed
 *
 * Reads the personalized "while you were away" companion-activity feed
 * (lib/universe/feed-builder.ts's getUserFeed) that tickUserFeeds() has
 * been fanning out to `user_feeds` on the `feed_build` job every ~2h.
 * getUserFeed() had zero callers anywhere and there was no GET route for
 * it at all — only POST mark-read existed, with nothing to mark read.
 * This is the missing read side; the Home page consumes getUserFeed()
 * directly for its initial server-rendered pull (thin-wrapper case per
 * FRONTEND_DIRECTIVE §10), and this route exists for the same data over
 * HTTP for any client-side refetch (e.g. after mark-read) or future
 * (mobile) consumer.
 *
 * Query params: ?limit=20&unreadOnly=true
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { getUserFeed } from '@/lib/universe/feed-builder';
import { toErrorBody } from '@/lib/errors';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 20, 1), 50) : 20;
    const unreadOnly = searchParams.get('unreadOnly') === 'true';

    const entries = await getUserFeed(user.id, limit, unreadOnly);

    return NextResponse.json({ entries });
  } catch (err) {
    logger.error('user/feed error', { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(toErrorBody(err), { status: 500 });
  }
}

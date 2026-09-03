/**
 * POST /api/user/feed/mark-read
 *
 * Marks entries in the user's personalized companion-activity feed as read
 * (lib/universe/feed-builder.ts's markFeedRead). Optionally scoped to one
 * character via `characterId` in the body; otherwise marks the whole feed.
 *
 * This is the read-side wiring feed-builder.ts was missing entirely — the
 * tick job (`feed_build`) has been fanning out companion activity to
 * `user_feeds` on schedule, but nothing ever read or acknowledged it until
 * the "While You Were Away" section on /my-ai started consuming it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { markFeedRead } from '@/lib/universe/feed-builder';
import { toErrorBody } from '@/lib/errors';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const characterId = typeof body?.characterId === 'string' ? body.characterId : undefined;

    await markFeedRead(user.id, characterId);

    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error('user/feed/mark-read error', { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(toErrorBody(err), { status: 500 });
  }
}

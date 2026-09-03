/**
 * POST /api/roleplay/[sessionId]/end
 *
 * Exits Story Mode early (before the scenario's chapters are exhausted).
 * Marks the session 'abandoned' and clears roleplay_mode on the underlying
 * conversation — the conversation itself, and everything said during the
 * story, remains as ordinary chat history.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { logger } from '@/lib/logger';
import { abandonSession, RoleplayError } from '@/lib/roleplay/engine';

export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, props: { params: Promise<{ sessionId: string }> }) {
  const params = await props.params;

  const { user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    await abandonSession({ userId: user.id, sessionId: params.sessionId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof RoleplayError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    logger.error('api/roleplay/end error', {
      error: err instanceof Error ? err.message : String(err),
      userId: user.id,
      sessionId: params.sessionId,
    });
    return NextResponse.json({ error: 'Could not end the story', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

/**
 * GET /api/dating/date/active?matchId=...
 *
 * Looks up the in-progress date_sessions row (if any) for a match, so the
 * match page can render "date in progress" state (opening scene + Complete
 * button) on load instead of the frontend only discovering an active
 * session indirectly via a 409 DATE_ALREADY_ACTIVE from /date/start.
 * Read-only counterpart to start/[id]/complete — no new mutation surface.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { getActiveDateSessionForMatch } from '@/lib/dating/get-match-detail';

export const dynamic = 'force-dynamic';

const schema = z.object({ matchId: z.string().uuid() });

// ROOT-CAUSE FIX (2026-08-25): logic moved to
// lib/dating/get-match-detail.ts (getActiveDateSessionForMatch) so
// (app)/dating/match/[id]/page.tsx can call it in-process instead of
// self-fetching this route — see that file's header comment. This handler
// is now a thin wrapper, still serving any client-side/external caller.
export async function GET(req: NextRequest) {
  const { user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = schema.safeParse({ matchId: req.nextUrl.searchParams.get('matchId') });
  if (!parsed.success) return NextResponse.json({ error: 'matchId required' }, { status: 400 });

  try {
    const session = await getActiveDateSessionForMatch(user.id, parsed.data.matchId);
    return NextResponse.json({ session });
  } catch {
    return NextResponse.json({ error: 'Could not check date status' }, { status: 500 });
  }
}

/**
 * GET /api/dating/matches
 * List all matches for the current user with character details, bond scores,
 * streak info, and recent milestones. Sorted by bond_score desc.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { getMatchesForUser, getMatchIdForCharacter } from '@/lib/dating/get-match-detail';

export const dynamic = 'force-dynamic';

// ROOT-CAUSE FIX (2026-08-25): the actual list/lookup logic now lives in
// lib/dating/get-match-detail.ts (getMatchesForUser / getMatchIdForCharacter)
// so (app)/dating/match/[id]/page.tsx can call it in-process instead of
// self-fetching this route — see that file's header comment. This handler
// is now a thin wrapper, still serving any client-side/external caller.
export async function GET(req: NextRequest) {
  const { user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // MOOD-SYNC-FIX: lightweight, read-only lookup for a single character's
  // match id — added for the chat-window mood-sync hook, which needs to
  // know whether a dating_matches row already exists for this character
  // before calling /api/dating/mood on session end (it must never create
  // one — that would silently enrol every companion chat into the dating
  // system, unlike gift-access's intentional get-or-create). Kept on this
  // route rather than a new one since it's the same table/shape this route
  // already owns, just filtered to one row with no side effects.
  const characterId = req.nextUrl.searchParams.get('characterId');
  if (characterId) {
    const matchId = await getMatchIdForCharacter(user.id, characterId);
    return NextResponse.json({ matchId });
  }

  let enriched;
  try {
    enriched = await getMatchesForUser(user.id);
  } catch {
    return NextResponse.json({ error: 'Failed to load matches' }, { status: 500 });
  }

  return NextResponse.json({ matches: enriched, total: enriched.length });
}

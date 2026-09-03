/**
 * GET /api/universe/status?characterId=...   — one companion's status + legend
 * GET /api/universe/status                    — status leaderboard
 */

import { NextRequest, NextResponse }  from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { getSocialStatus, getStatusLeaderboard, getLegend } from '@/lib/universe/status-legend';
import { getCharacterAttributes }     from '@/lib/universe/character-evolution';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url         = new URL(req.url);
  const characterId = url.searchParams.get('characterId');

  if (characterId) {
    const [status, legend, attributes] = await Promise.all([
      getSocialStatus(characterId),
      getLegend(characterId),
      getCharacterAttributes(characterId),
    ]);
    return NextResponse.json({ status, legend, attributes });
  }

  const leaderboard = await getStatusLeaderboard(20);
  return NextResponse.json({ leaderboard });
}

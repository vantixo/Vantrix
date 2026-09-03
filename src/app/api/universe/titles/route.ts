/**
 * GET /api/universe/titles?characterId=...   — one companion's held titles
 * GET /api/universe/titles?key=most_trusted  — leaderboard for a single title
 * GET /api/universe/titles                    — all leaderboards, keyed by title
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { getCharacterTitles, getTitleLeaderboard } from '@/lib/universe/reputation-titles';
import type { ReputationTitleKey } from '@/types/world-expansion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALL_KEYS: ReputationTitleKey[] = [
  'most_trusted', 'most_influential', 'most_loved', 'most_feared',
  'most_generous', 'most_mysterious', 'most_admired', 'most_notorious',
];

export async function GET(req: NextRequest) {
  const { user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url         = new URL(req.url);
  const characterId = url.searchParams.get('characterId');
  const key         = url.searchParams.get('key') as ReputationTitleKey | null;

  if (characterId) {
    const titles = await getCharacterTitles(characterId);
    return NextResponse.json({ titles });
  }

  if (key && ALL_KEYS.includes(key)) {
    const leaderboard = await getTitleLeaderboard(key);
    return NextResponse.json({ key, leaderboard });
  }

  const entries = await Promise.all(ALL_KEYS.map(async (k) => [k, await getTitleLeaderboard(k)] as const));
  return NextResponse.json({ leaderboards: Object.fromEntries(entries) });
}

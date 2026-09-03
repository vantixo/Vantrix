/**
 * GET /api/universe/history                          — global timeline
 * GET /api/universe/history?locationId=...            — city timeline
 * GET /api/universe/history?characterId=...           — character biography
 * GET /api/universe/history?significant=true          — most significant events
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import {
  getWorldTimeline, getCityTimeline, getCharacterBiography, getMostSignificantEvents,
} from '@/lib/universe/world-history';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url          = new URL(req.url);
  const locationId    = url.searchParams.get('locationId');
  const characterId   = url.searchParams.get('characterId');
  const significant   = url.searchParams.get('significant') === 'true';
  const limit          = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);

  if (characterId) {
    const biography = await getCharacterBiography(characterId, limit);
    return NextResponse.json({ biography });
  }

  if (locationId) {
    const timeline = await getCityTimeline(locationId, limit);
    return NextResponse.json({ timeline });
  }

  if (significant) {
    const events = await getMostSignificantEvents(limit);
    return NextResponse.json({ events });
  }

  const timeline = await getWorldTimeline(limit);
  return NextResponse.json({ timeline });
}

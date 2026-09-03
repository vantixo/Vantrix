/**
 * GET /api/universe/factions             — all factions (index)
 * GET /api/universe/factions?slug=...     — single faction, full detail + members
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { getAllFactions, getFactionBySlug } from '@/lib/universe/world-atlas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const slug = new URL(req.url).searchParams.get('slug');

  if (slug) {
    const faction = await getFactionBySlug(slug);
    if (!faction) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ faction });
  }

  const factions = await getAllFactions();
  return NextResponse.json({ factions });
}

/**
 * GET /api/universe/artifacts                      — all scarce assets
 * GET /api/universe/artifacts?unclaimed=true        — unclaimed assets only
 * GET /api/universe/artifacts?characterId=...       — one companion's holdings
 * GET /api/universe/artifacts?id=...                — single asset detail
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import {
  getAllScarceAssets, getUnclaimedAssets, getCharacterAssets, getAsset,
} from '@/lib/universe/scarcity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url          = new URL(req.url);
  const id            = url.searchParams.get('id');
  const characterId   = url.searchParams.get('characterId');
  const unclaimedOnly = url.searchParams.get('unclaimed') === 'true';

  if (id) {
    const asset = await getAsset(id);
    if (!asset) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ asset });
  }

  if (characterId) {
    const assets = await getCharacterAssets(characterId);
    return NextResponse.json({ assets });
  }

  if (unclaimedOnly) {
    const assets = await getUnclaimedAssets();
    return NextResponse.json({ assets });
  }

  const assets = await getAllScarceAssets();
  return NextResponse.json({ assets });
}

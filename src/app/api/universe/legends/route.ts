/**
 * GET /api/universe/legends   — all active legends in the universe
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { getActiveLegends }          from '@/lib/universe/status-legend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  const { user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const legends = await getActiveLegends();
  return NextResponse.json({ legends, max_legends: 12, count: legends.length });
}

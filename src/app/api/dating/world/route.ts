/**
 * GET /api/dating/world
 *
 * Feature 1 — "Your World" dating home.
 *
 * ROOT-CAUSE FIX (2026-08-23): the aggregation logic that used to live
 * inline in this file has moved to lib/dating/get-world-home.ts so it can
 * be called directly (no HTTP self-fetch) from (app)/dating/page.tsx. See
 * that file's header comment for the full root-cause writeup — this route
 * is now a thin auth-check + wrapper, kept for any client-side/external
 * caller that still needs the real HTTP endpoint.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { getDatingWorldHome } from '@/lib/dating/get-world-home';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  const { user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const world = await getDatingWorldHome(user.id);
  return NextResponse.json(world);
}

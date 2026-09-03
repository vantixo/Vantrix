/**
 * GET /api/dating/chemistry?matchId=...
 *
 * Feature 3 — Chemistry Engine. Returns the multi-dimensional breakdown
 * from chemistry-dimensions.ts for a single match, composed from
 * attachment-engine.ts (psychology), compatibility-engine.ts (values/
 * interest/communication fit), and the dating_matches row itself
 * (bond_score, streak_days, conversation_count). No LLM call — every
 * input is already computed/stored elsewhere; this route just fetches
 * and composes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { getChemistryForMatch } from '@/lib/dating/get-match-detail';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const schema = z.object({ matchId: z.string().uuid() });

// ROOT-CAUSE FIX (2026-08-25): logic moved to
// lib/dating/get-match-detail.ts (getChemistryForMatch) so
// (app)/dating/match/[id]/page.tsx can call it in-process instead of
// self-fetching this route — see that file's header comment. This handler
// is now a thin wrapper, still serving any client-side/external caller.
export async function GET(req: NextRequest) {
  const { user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = schema.safeParse({ matchId: req.nextUrl.searchParams.get('matchId') });
  if (!parsed.success) return NextResponse.json({ error: 'matchId required' }, { status: 400 });

  const dimensions = await getChemistryForMatch(user.id, parsed.data.matchId);
  if (!dimensions) return NextResponse.json({ error: 'Match not found' }, { status: 404 });

  return NextResponse.json({ dimensions });
}

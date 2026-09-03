/**
 * GET /api/dating/compatibility?matchId=...
 *
 * Dynamic compatibility score — recomputed at most once per 24 hours OR
 * when conversation_count crosses the next 10-conversation threshold.
 *
 * Factors:
 *   1. Topic overlap — user_facts topics vs character archetypes
 *   2. Emotional tone — psychology trust/affection/attachment levels
 *   3. Engagement consistency — message frequency, session length
 *   4. Base compatibility — initial personality match at swipe time
 *
 * Returns the current score, delta from last compute, and next recompute threshold.
 *
 * BUG-5 FIX: The previous recompute guard was:
 *   convsSinceUpdate = lastUpdate ? convCount - 0 : convCount
 * `convCount - 0` is a no-op, so `convsSinceUpdate === convCount` always,
 * meaning every call after 10 conversations triggered a full recompute and
 * a DB write. Fix: gate on elapsed wall-clock time (≥24h) OR conversation
 * count threshold, whichever comes first.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { z }                         from 'zod';
import { getCompatibilityForMatch }  from '@/lib/dating/get-match-detail';

export const dynamic = 'force-dynamic';

const schema = z.object({ matchId: z.string().uuid() });

// ROOT-CAUSE FIX (2026-08-25): all the scoring/recompute logic (including
// the BUG-5 delta-vs-baseline fix noted below) moved to
// lib/dating/get-match-detail.ts (getCompatibilityForMatch) so
// (app)/dating/match/[id]/page.tsx can call it in-process instead of
// self-fetching this route — see that file's header comment. This handler
// is now a thin wrapper, still serving any client-side/external caller.
//
// BUG-5 FIX (2026-08-06, corrected — see 20260922 migration for full
// history, preserved here): the prior fix compared conversation_count
// directly against RECOMPUTE_CONVOS with no stored baseline, so it was an
// absolute check that latched permanently true past 10 total conversations
// — the exact "recompute every call" failure mode the comment claimed to
// have fixed, just via a different arithmetic mistake. Now a true delta
// against the conversation count stored at the last recompute.
export async function GET(req: NextRequest) {
  const { user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sp     = req.nextUrl.searchParams;
  const parsed = schema.safeParse({ matchId: sp.get('matchId') });
  if (!parsed.success) return NextResponse.json({ error: 'matchId required' }, { status: 400 });

  const result = await getCompatibilityForMatch(user.id, parsed.data.matchId);
  if (!result) return NextResponse.json({ error: 'Match not found' }, { status: 404 });

  return NextResponse.json(result);
}

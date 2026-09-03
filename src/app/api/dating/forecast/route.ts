/**
 * GET /api/dating/forecast?matchId=...
 *
 * Feature 15 — Relationship Forecast. Entirely computed from existing data
 * (dating_matches, dating_compatibility.breakdown, dating_gifts count) via
 * computeRelationshipForecast() in src/lib/dating/engine.ts. No LLM call —
 * this keeps the language honest and hedged rather than risking the model
 * inventing behavioral claims, and costs nothing beyond a couple of cheap
 * reads.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { getForecastForMatch } from '@/lib/dating/get-match-detail';
import { toErrorBody, errorLogFields } from '@/lib/errors';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const schema = z.object({ matchId: z.string().uuid() });

// ROOT-CAUSE FIX (2026-08-25): logic moved to
// lib/dating/get-match-detail.ts (getForecastForMatch) so
// (app)/dating/match/[id]/page.tsx can call it in-process instead of
// self-fetching this route — see that file's header comment. This handler
// is now a thin wrapper, still serving any client-side/external caller.
export async function GET(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

    const parsed = schema.safeParse({ matchId: req.nextUrl.searchParams.get('matchId') });
    if (!parsed.success) return NextResponse.json({ error: 'matchId required', code: 'VALIDATION_ERROR' }, { status: 400 });
    const { matchId } = parsed.data;

    const forecast = await getForecastForMatch(user.id, matchId);
    if (!forecast) return NextResponse.json({ error: 'Match not found' }, { status: 404 });

    return NextResponse.json({ matchId, forecast });
  } catch (err) {
    logger.error('dating-forecast:error', errorLogFields(err));
    return NextResponse.json(toErrorBody(err), { status: 500 });
  }
}

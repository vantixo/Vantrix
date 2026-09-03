/**
 * GET  /api/dating/prestige?matchId=...  — get current chapter + beat status
 * POST /api/dating/prestige              — advance chapter/beat (called by cron or mood update)
 *
 * BUG-1 FIX: character_id was never in the select, causing all three initiative
 *   inserts in POST to either store the user's UUID (chapter 1: match.user_id)
 *   or omit the NOT-NULL column entirely (beats/chapters). Both paths threw DB
 *   constraint violations. The non-existent match_id column was also silently
 *   ignored. All three inserts now use match.character_id, which is the correct
 *   FK for character_initiatives.character_id.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { z }                         from 'zod';
import { supabaseAdmin }             from '@/lib/supabase/admin';
import { advancePrestige }           from '@/lib/dating/prestige-chapters';
import { getPrestigeForMatch }       from '@/lib/dating/get-match-detail';

export const dynamic = 'force-dynamic';

const getSchema  = z.object({ matchId: z.string().uuid() });
const postSchema = z.object({ matchId: z.string().uuid() });

// ROOT-CAUSE FIX (2026-08-25): the GET-path chapter/beat lookup logic moved
// to lib/dating/get-match-detail.ts (getPrestigeForMatch) so
// (app)/dating/match/[id]/page.tsx can call it in-process instead of
// self-fetching this route — see that file's header comment. This handler
// is now a thin wrapper, still serving any client-side/external caller.
// POST (advance) is unaffected — it's only ever called from a client
// component / cron, never self-fetched from a Server Component.
export async function GET(req: NextRequest) {
  const { user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sp     = req.nextUrl.searchParams;
  const parsed = getSchema.safeParse({ matchId: sp.get('matchId') });
  if (!parsed.success) return NextResponse.json({ error: 'matchId required' }, { status: 400 });

  const result = await getPrestigeForMatch(user.id, parsed.data.matchId);
  if (!result) return NextResponse.json({ error: 'Match not found' }, { status: 404 });

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const { user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body   = await req.json().catch(() => ({}));
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const result = await advancePrestige(supabaseAdmin, user.id, parsed.data.matchId);
  return NextResponse.json(result);
}

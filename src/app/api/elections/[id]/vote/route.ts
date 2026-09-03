/**
 * POST   /api/elections/[id]/vote  — cast or change a vote { candidateId }
 * DELETE /api/elections/[id]/vote  — retract a vote
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { castUserVote, retractUserVote } from '@/lib/universe/elections';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: electionId } = await params;
  const body = await req.json().catch(() => null);
  const candidateId = body?.candidateId as string | undefined;

  if (!candidateId) {
    return NextResponse.json({ error: 'candidateId is required' }, { status: 400 });
  }

  const result = await castUserVote(electionId, candidateId, user.id);
  if (!result.ok) {
    const status = result.reason === 'voting_closed' || result.reason === 'candidate_not_found' ? 400 : 500;
    return NextResponse.json({ error: result.reason ?? 'vote_failed' }, { status });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: electionId } = await params;
  const result = await retractUserVote(electionId, user.id);
  if (!result.ok) return NextResponse.json({ error: result.reason ?? 'retract_failed' }, { status: 500 });

  return NextResponse.json({ ok: true });
}

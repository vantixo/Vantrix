/**
 * POST   /api/laws/[id]/vote  — cast or change a position { position: 'support' | 'oppose' }
 * DELETE /api/laws/[id]/vote  — retract a vote
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { castLawVote, retractLawVote } from '@/lib/universe/laws';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: lawId } = await params;
  const body = await req.json().catch(() => null);
  const position = body?.position as string | undefined;

  if (position !== 'support' && position !== 'oppose') {
    return NextResponse.json({ error: 'position must be "support" or "oppose"' }, { status: 400 });
  }

  const result = await castLawVote(lawId, position, user.id);
  if (!result.ok) {
    const status = result.reason === 'voting_closed' || result.reason === 'law_not_found' ? 400 : 500;
    return NextResponse.json({ error: result.reason ?? 'vote_failed' }, { status });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: lawId } = await params;
  const result = await retractLawVote(lawId, user.id);
  if (!result.ok) return NextResponse.json({ error: result.reason ?? 'retract_failed' }, { status: 500 });

  return NextResponse.json({ ok: true });
}

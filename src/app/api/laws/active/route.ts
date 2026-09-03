/**
 * GET /api/laws/active — active (status = 'proposed') law proposals,
 * with the requesting user's own position if they've voted.
 */

import { NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { getActiveLawsForUser } from '@/lib/universe/laws';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const laws = await getActiveLawsForUser(user.id);
  return NextResponse.json({ laws });
}

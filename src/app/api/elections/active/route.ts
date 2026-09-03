/**
 * GET /api/elections/active — active (campaigning/voting) elections,
 * with candidates and the requesting user's own vote if they've cast one.
 */

import { NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { getActiveElectionsForUser } from '@/lib/universe/elections';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const elections = await getActiveElectionsForUser(user.id);
  return NextResponse.json({ elections });
}

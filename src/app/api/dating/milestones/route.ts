import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const matchId = searchParams.get('matchId');

  const { user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });


  let query = supabaseAdmin.from('dating_milestones')
    .select('*').eq('user_id', user.id).order('created_at', { ascending: false });

  if (matchId) query = query.eq('match_id', matchId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: 'Failed to load milestones' }, { status: 500 });
  return NextResponse.json({ milestones: data ?? [] });
}

/**
 * GET /api/profile
 * Returns the current user's profile data.
 *
 * QUAL-5 (FIXED): This route was missing, causing the Gift Shop (which fetches
 *   the user's token balance via /api/profile) to 404 and display 0 tokens.
 */
import { NextResponse }  from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { supabase, user } = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id,username,avatar_url,tier,tokens,daily_messages_used,daily_messages_limit,country,currency,created_at')
    .eq('id', user.id)
    .single();

  if (error || !profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  return NextResponse.json({ profile });
}

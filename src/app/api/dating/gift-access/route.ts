/**
 * POST /api/dating/gift-access
 *
 * Gifting is a chat feature, not a dating feature — this endpoint gets (or
 * silently creates) the underlying dating_matches row a gift needs to be
 * recorded against, WITHOUT requiring the user to swipe/match through the
 * dating flow first. It never touches dating_swipes, never runs the
 * reciprocation/compatibility roll, and never counts against swipe limits —
 * it's purely plumbing so the in-chat Gift button can open the Gift Shop
 * directly instead of redirecting into /dating.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const schema = z.object({
  characterId: z.string().uuid(),
});

export async function POST(req: NextRequest) {
  const { user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const raw = await req.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const { characterId } = parsed.data;
  const userId = user.id;

  const { data: character } = await supabaseAdmin
    .from('characters')
    .select('id,active')
    .eq('id', characterId)
    .single();
  if (!character || !character.active) {
    return NextResponse.json({ error: 'Character not found' }, { status: 404 });
  }

  const { data: existing } = await supabaseAdmin
    .from('dating_matches')
    .select('id,match_tier,bond_score')
    .eq('user_id', userId)
    .eq('character_id', characterId)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ matchId: existing.id, matchTier: existing.match_tier, bondScore: existing.bond_score });
  }

  // First-ever gift to this character with no prior match — create a bare
  // gifting-only match row. Starts at the lowest tier/bond exactly like a
  // fresh "like" match does; the person can still never see a swipe deck if
  // they don't want to, gifting and dating stay independent from here on.
  const { data: created, error } = await supabaseAdmin
    .from('dating_matches')
    .insert({
      user_id:          userId,
      character_id:     characterId,
      compatibility_pct: 0,
      match_tier:        'spark',
      bond_score:        0,
      last_interaction:  new Date().toISOString(),
    })
    .select('id,match_tier,bond_score')
    .single();

  if (error || !created) return NextResponse.json({ error: 'Could not open gift shop' }, { status: 500 });

  return NextResponse.json({ matchId: created.id, matchTier: created.match_tier, bondScore: created.bond_score });
}

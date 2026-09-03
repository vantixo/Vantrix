/**
 * POST /api/dating/share-card
 *
 * Creates a shareable milestone/relationship card via the viral-share system.
 * Returns shareUrl and ogImageUrl for the card.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { z }                         from 'zod';
import { createMilestoneCard, createRelationshipCard } from '@/lib/growth/viral-share';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const milestoneSchema = z.object({
  type:           z.literal('milestone'),
  characterName:  z.string().max(100),
  characterImage: z.string().url().or(z.string().startsWith('/')),
  milestoneKey:   z.string().max(50),
  milestoneLabel: z.string().max(100),
  milestoneEmoji: z.string().max(10),
  bondScore:      z.number().int().min(0).max(100),
  streakDays:     z.number().int().min(0).optional().default(0),
  characterId:    z.string().uuid().optional(),
});

const relationshipSchema = z.object({
  type:           z.literal('relationship'),
  characterId:    z.string().uuid(),
  characterName:  z.string().max(100),
  characterImage: z.string(),
  bondScore:      z.number().int().min(0).max(100),
  matchTier:      z.string().max(20),
  compatibility:  z.number().int().min(0).max(100),
  mood:           z.string().max(20),
  streakDays:     z.number().int().min(0).optional().default(0),
  daysKnown:      z.number().int().min(0).optional().default(0),
});

const bodySchema = z.discriminatedUnion('type', [milestoneSchema, relationshipSchema]);

export async function POST(req: NextRequest) {
  const { user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });


  const raw    = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const body = parsed.data;

  // SEC/DATA-INTEGRITY FIX (Phase B audit, 2026-08-06): two issues.
  //
  // 1) BUG: when milestoneSchema.characterId was omitted, the old code
  //    fell back to `user.id` as character_id — but character_id is a
  //    real FK to characters(id) (see 20240101_production.sql), not
  //    profiles(id). That FK constraint would reject virtually every such
  //    insert outright, silently breaking the entire no-characterId
  //    milestone-card path (every call returned a 500 "creation failed").
  //
  // 2) SPOOFING: characterName/characterImage/bondScore/matchTier/
  //    compatibility/mood/streakDays/daysKnown are ALL client-supplied
  //    with zero server-side verification against real relationship
  //    data — a user could fabricate a card claiming e.g. 100%
  //    compatibility with any character name/image and have Vantrix's
  //    own server generate and publicly serve that as a shareable image.
  //    Full fix would mean re-deriving bondScore/compatibility/mood from
  //    the actual companion-state subsystem server-side, which is a
  //    larger, separate piece of scope — the proportionate fix applied
  //    here is verifying that, when a characterId is given, the calling
  //    user actually has an existing conversation with that character
  //    (i.e. some real relationship exists), closing the "claim a card
  //    for a character you've never talked to" impersonation surface
  //    without attempting to re-derive the numeric stats themselves.
  const characterId = body.characterId ?? null;
  if (characterId) {
    const { data: conv } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('user_id', user.id)
      .eq('character_id', characterId)
      .maybeSingle();
    if (!conv) {
      return NextResponse.json({ error: 'No relationship exists with this character' }, { status: 403 });
    }
  }

  let card;
  if (body.type === 'milestone') {
    card = await createMilestoneCard(user.id, characterId, {
      characterName:  body.characterName,
      characterImage: body.characterImage,
      milestoneKey:   body.milestoneKey,
      milestoneLabel: body.milestoneLabel,
      milestoneEmoji: body.milestoneEmoji,
      bondScore:      body.bondScore,
      streakDays:     body.streakDays ?? 0,
    });
  } else {
    card = await createRelationshipCard(user.id, characterId as string, {
      characterName:  body.characterName,
      characterImage: body.characterImage,
      bondScore:      body.bondScore,
      matchTier:      body.matchTier,
      compatibility:  body.compatibility,
      mood:           body.mood,
      streakDays:     body.streakDays ?? 0,
      daysKnown:      body.daysKnown ?? 0,
    });
  }

  if (!card) return NextResponse.json({ error: 'Share card creation failed' }, { status: 500 });

  return NextResponse.json({
    shareUrl:   card.shareUrl,
    ogImageUrl: card.ogImageUrl,
    cardId:     card.id,
  });
}

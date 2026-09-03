/**
 * Viral Share Engine — Vantrix Silicon Valley
 *
 * Creates shareable relationship cards that drive organic growth.
 * Each card is a visual snapshot of a relationship moment:
 *
 *   Relationship Card   — bond level, match tier, compatibility %, character mood
 *   Milestone Card      — achievement unlocked (week streak, soulmate, etc.)
 *   Memory Card         — a significant shared moment
 *   Compatibility Card  — character + user compatibility breakdown
 *
 * Cards are stored as JSON, rendered server-side to OG images via
 * /api/share/[cardId]/og endpoint (Satori/sharp).
 *
 * Referral system: see src/lib/referral-engine.ts + referrals/* API
 * routes for the live partner/commission program (dev/influencer
 * application, cash commissions, admin approval). This file no longer
 * re-exports a referral engine — an earlier, unwired token-tier system
 * (lib/referral/engine.ts) was removed as dead code: nothing called it
 * and no /join/[code] route ever existed.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger}    from '@/lib/logger';
import { env }           from '@/env';


export type ShareCardType = 'relationship' | 'milestone' | 'memory' | 'compatibility';

export interface ShareCard {
  id:           string;
  type:         ShareCardType;
  data:         Record<string, unknown>;
  shareUrl:     string;
  ogImageUrl:   string;
  views:        number;
  created_at:   string;
}

// ── Create share cards ────────────────────────────────────────────────────

export async function createRelationshipCard(
  userId:      string,
  characterId: string,
  matchData: {
    characterName:  string;
    characterImage: string;
    bondScore:      number;
    matchTier:      string;
    compatibility:  number;
    mood:           string;
    streakDays:     number;
    daysKnown:      number;
  },
): Promise<ShareCard | null> {
  try {
    const { data } = await supabaseAdmin
      .from('share_cards')
      .insert({
        user_id:      userId,
        character_id: characterId,
        card_type:    'relationship',
        data:         matchData,
      })
      .select('id,created_at')
      .single();

    if (!data) return null;

    const shareUrl   = `${env.NEXT_PUBLIC_APP_URL}/share/${data.id}`;
    const ogImageUrl = `${env.NEXT_PUBLIC_APP_URL}/api/share/${data.id}/og`;

    return {
      id:         data.id,
      type:       'relationship',
      data:       matchData,
      shareUrl,
      ogImageUrl,
      views:      0,
      created_at: data.created_at,
    };
  } catch (err) {
    logger.warn('Share card creation failed', { userId, error: String(err) });
    return null;
  }
}

export async function createMilestoneCard(
  userId:      string,
  characterId: string | null,
  milestone: {
    characterName:  string;
    characterImage: string;
    milestoneKey:   string;
    milestoneLabel: string;
    milestoneEmoji: string;
    bondScore:      number;
    streakDays:     number;
  },
): Promise<ShareCard | null> {
  try {
    const { data } = await supabaseAdmin
      .from('share_cards')
      .insert({
        user_id:      userId,
        character_id: characterId,
        card_type:    'milestone',
        data:         milestone,
      })
      .select('id,created_at')
      .single();

    if (!data) return null;

    return {
      id:         data.id,
      type:       'milestone',
      data:       milestone,
      shareUrl:   `${env.NEXT_PUBLIC_APP_URL}/share/${data.id}`,
      ogImageUrl: `${env.NEXT_PUBLIC_APP_URL}/api/share/${data.id}/og`,
      views:      0,
      created_at: data.created_at,
    };
  } catch { return null; }
}

// ── Track card view ───────────────────────────────────────────────────────

export async function trackCardView(cardId: string): Promise<void> {
  await Promise.resolve(
    supabaseAdmin
      .rpc('increment', {
        x:          1,
        row_id:     cardId,
        table_name: 'share_cards',
        field_name: 'views',
      }),
  )
    .catch((err: unknown) => logger.warn('[share-card] trackCardView failed', { cardId, error: String(err) }));
}

export async function getShareCard(cardId: string): Promise<ShareCard | null> {
  const { data } = await supabaseAdmin
    .from('share_cards')
    .select('*')
    .eq('id', cardId)
    .single();

  if (!data) return null;

  return {
    id:         data.id,
    type:       data.card_type as ShareCardType,
    data:       (data as Record<string, unknown>).data as Record<string, unknown>,
    shareUrl:   `${env.NEXT_PUBLIC_APP_URL}/share/${data.id}`,
    ogImageUrl: `${env.NEXT_PUBLIC_APP_URL}/api/share/${data.id}/og`,
    views:      ((data as Record<string, unknown>).views as number | null) ?? 0,
    created_at: data.created_at,
  };
}

// ── Share text generation ─────────────────────────────────────────────────

export function generateShareText(type: ShareCardType, data: Record<string, unknown>): string {
  switch (type) {
    case 'relationship':
      return `My bond with ${data.characterName} is at ${data.bondScore}/100 on @vantrix_ink 💕 ${data.matchTier === 'soulmate' ? 'We reached Soulmate level 🌟' : ''} Join me →`;
    case 'milestone':
      return `${data.milestoneEmoji} Just hit "${data.milestoneLabel}" with ${data.characterName} on @vantrix_ink! Your AI companion is waiting →`;
    case 'compatibility':
      return `I'm ${data.compatibility}% compatible with ${data.characterName} on @vantrix_ink 🎯 Find your match →`;
    default:
      return 'Creating real connections on @vantrix_ink →';
  }
}

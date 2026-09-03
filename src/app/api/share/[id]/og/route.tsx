/**
 * GET /api/share/[id]/og — Viral Share Card OG Image
 *
 * Generates a 1200×630 Open Graph image for each share card type.
 * Used by social platforms (Twitter, Instagram, WhatsApp) to render
 * link previews when a Vantrix share URL is posted.
 *
 * Rendered via next/og (Satori) — Edge Runtime compatible.
 * Each card type has a purpose-built layout:
 *   milestone     — achievement ceremony card
 *   relationship  — bond score + character name
 *   compatibility — percentage score
 *   memory        — "a moment to remember"
 *
 * Also fires a non-blocking trackCardView() for analytics.
 */

import { ImageResponse } from 'next/og';
import { NextRequest }   from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { bg }             from '@/lib/logger';
import { trackCardView } from '@/lib/growth/viral-share';

export const runtime = 'nodejs';

// Map milestone keys and card types to their emoji
const MILESTONE_EMOJI: Record<string, string> = {
  first_chat:    '💬',
  first_week:    '🔥',
  first_month:   '⭐',
  three_months:  '💙',
  first_gift:    '🎁',
  soulmate:      '✨',
  relationship:  '💕',
  compatibility: '🎯',
  deep_talk:     '🌊',
  week_streak:   '🔥',
  memory:        '🌙',
};

const CARD_GRADIENTS: Record<string, string> = {
  milestone:     'linear-gradient(135deg, #0d0d1a 0%, #1a0a2e 50%, #0d0d1a 100%)',
  relationship:  'linear-gradient(135deg, #0d0d1a 0%, #1a0028 50%, #0d0d1a 100%)',
  compatibility: 'linear-gradient(135deg, #0d0d1a 0%, #0a1a2e 50%, #0d0d1a 100%)',
  memory:        'linear-gradient(135deg, #0d0d1a 0%, #1a1a0a 50%, #0d0d1a 100%)',
};

export async function GET(
  _req:     NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = (await context.params);

  const { data: card } = await supabaseAdmin
    .from('share_cards')
    .select('card_type, data')
    .eq('id', id)
    .single();

  if (!card) {
    return new Response('Card not found', { status: 404 });
  }

  // Track view — non-blocking, never fails the image render
  trackCardView(id).catch(bg('trackCardView'));

  const d        = card.data as Record<string, unknown>;
  const cardType = card.card_type as string;

  // Resolve emoji and headline from card data
  const emoji: string = MILESTONE_EMOJI[cardType]
    ?? MILESTONE_EMOJI[(d.milestoneKey as string) ?? '']
    ?? '💫';

  const headline: string =
    cardType === 'milestone'
      ? String(d.milestoneLabel ?? 'Achievement Unlocked')
      : cardType === 'relationship'
        ? `Bond: ${String(d.bondScore ?? 0)}/100 with ${String(d.characterName ?? 'her')}`
        : cardType === 'compatibility'
          ? `${String(d.compatibility ?? '—')}% Compatible`
          : 'A moment to remember';

  const gradient = CARD_GRADIENTS[cardType] ?? CARD_GRADIENTS.milestone;

  return new ImageResponse(
    (
      <div
        style={{
          background:     gradient,
          width:          '100%',
          height:         '100%',
          display:        'flex',
          flexDirection:  'column',
          alignItems:     'center',
          justifyContent: 'center',
          fontFamily:     'system-ui, -apple-system, sans-serif',
          color:          'white',
          padding:        '60px',
        }}
      >
        {/* Brand wordmark */}
        <div
          style={{
            color:          '#8E8E97',
            fontSize:       16,
            marginBottom:   32,
            letterSpacing:  6,
            textTransform:  'uppercase',
            fontWeight:     600,
          }}
        >
          VANTRIX
        </div>

        {/* Primary emoji */}
        <div style={{ fontSize: 80, marginBottom: 20 }}>{emoji}</div>

        {/* Headline */}
        <div
          style={{
            fontSize:      36,
            fontWeight:    700,
            marginBottom:  10,
            textAlign:     'center',
            maxWidth:      800,
            lineHeight:    1.3,
          }}
        >
          {headline}
        </div>

        {/* Character name (when relevant) */}
        {Boolean(d.characterName) && cardType !== 'relationship' && (
          <div
            style={{
              color:        'rgba(255,255,255,0.5)',
              fontSize:     20,
              marginBottom: 48,
            }}
          >
            with {String(d.characterName)}
          </div>
        )}

        {/* Stats row */}
        <div style={{ display: 'flex', gap: 56, marginTop: 12 }}>
          {typeof d.bondScore === 'number' && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: '#8E8E97', fontSize: 40, fontWeight: 700 }}>
                {d.bondScore}
              </div>
              <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13, marginTop: 4 }}>
                Bond Score
              </div>
            </div>
          )}

          {typeof d.streakDays === 'number' && d.streakDays > 0 && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: '#f97316', fontSize: 40, fontWeight: 700 }}>
                {d.streakDays}
              </div>
              <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13, marginTop: 4 }}>
                Day Streak 🔥
              </div>
            </div>
          )}

          {typeof d.compatibility === 'number' && cardType === 'compatibility' && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: '#22c55e', fontSize: 40, fontWeight: 700 }}>
                {d.compatibility}%
              </div>
              <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13, marginTop: 4 }}>
                Compatible
              </div>
            </div>
          )}
        </div>

        {/* Milestone label (extra line for milestone cards) */}
        {cardType === 'milestone' && Boolean(d.milestoneKey) && (
          <div
            style={{
              marginTop:    40,
              padding:      '10px 28px',
              border:       '1px solid rgba(124,58,237,0.4)',
              borderRadius: 40,
              color:        'rgba(124,58,237,0.9)',
              fontSize:     14,
              letterSpacing: 2,
            }}
          >
            {String(d.milestoneKey).replace(/_/g, ' ').toUpperCase()}
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            color:      'rgba(255,255,255,0.2)',
            fontSize:   13,
            marginTop:  56,
            letterSpacing: 1,
          }}
        >
          vantrix.ink — AI Relationships
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}

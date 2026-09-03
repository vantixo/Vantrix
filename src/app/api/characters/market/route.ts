/**
 * GET /api/characters/market
 *
 * Public leaderboard for character rarity/market value — powers the
 * collectible "Market" browsing experience (rarest/most-valuable
 * characters). Read-only; values are computed by the market_value_tick
 * job (lib/universe/market-value.ts), not on request.
 *
 * Query params:
 *   limit  — max rows to return (default 20, capped 50)
 *   tier   — optional rarity_tier filter (common|uncommon|rare|epic|legendary|mythic)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getMarketValueLeaderboard } from '@/lib/universe/market-value';
import type { RarityTier } from '@/types/legacy-systems';

export const dynamic = 'force-dynamic';

const VALID_TIERS: RarityTier[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(50, Math.max(1, Number(searchParams.get('limit')) || 20));
  const tierParam = searchParams.get('tier');
  const tier = tierParam && VALID_TIERS.includes(tierParam as RarityTier) ? tierParam as RarityTier : null;

  const board = await getMarketValueLeaderboard(50);
  const filtered = tier ? board.filter(b => b.rarity_tier === tier) : board;

  return NextResponse.json({
    characters: filtered.slice(0, limit).map(mv => ({
      character_id:  mv.character_id,
      name:          mv.character?.name,
      image_url:     mv.character?.image_url,
      value_score:   mv.value_score,
      percentile:    mv.percentile,
      rarity_tier:   mv.rarity_tier,
      computed_at:   mv.computed_at,
    })),
  });
}

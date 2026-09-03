/**
 * Market Value & Rarity Engine — Vantrix
 *
 * Distinct from status-legend.ts: that engine simulates fictional in-world
 * standing (wealth, faction rank) for narrative flavor. This engine scores
 * REAL platform value — how much actual users have invested in a character
 * (likes, follows, swipes, conversations, gifts) — and turns that into a
 * rarity tier. This is the collectible/marketplace signal shown to users.
 *
 * Rarity is intentionally relative (percentile across the active roster)
 * plus a hard population cap per tier, not a fixed score threshold — so a
 * character can't "buy" Legendary just by crossing a number, and the top
 * tiers stay genuinely scarce as the whole roster's engagement grows.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';
import { redis }         from '@/lib/redis';
import type {
  CharacterMarketValue, MarketValueSignals, MarketValueTickResult, RarityTier,
} from '@/types/legacy-systems';
import {
  RARITY_TIER_PERCENTILE_FLOOR, RARITY_TIER_POPULATION_CAP,
} from '@/types/legacy-systems';

const CACHE = {
  value:       (charId: string) => `vantrix:market-value:${charId}`,
  leaderboard: 'vantrix:market-value:leaderboard',
};
const TTL = { value: 600, leaderboard: 300 };

// Weights — tuned so no single signal dominates. Follows and gifts (deliberate,
// repeatable acts of investment) weigh more than a one-tap like.
const WEIGHTS = {
  like:            1,
  follow:          4,
  swipe:           0.5,
  unique_chatter: 6,
  message:         0.15,
  gift:            10,
};

// ── Read ───────────────────────────────────────────────────────────────────────

export async function getCharacterMarketValue(characterId: string): Promise<CharacterMarketValue | null> {
  try {
    const cached = await redis.get<CharacterMarketValue>(CACHE.value(characterId));
    if (cached) return cached;
  } catch { /* ok */ }

  const { data, error } = await supabaseAdmin
    .from('character_market_value')
    .select('*, character:characters( id, name, image_url )')
    .eq('character_id', characterId)
    .maybeSingle();

  if (error || !data) return null;
  const value = data as unknown as CharacterMarketValue;
  try { await redis.set(CACHE.value(characterId), value, { ex: TTL.value }); } catch { /* ok */ }
  return value;
}

export async function getMarketValueLeaderboard(limit = 20): Promise<CharacterMarketValue[]> {
  try {
    const cached = await redis.get<CharacterMarketValue[]>(CACHE.leaderboard);
    if (cached) return cached.slice(0, limit);
  } catch { /* ok */ }

  const { data, error } = await supabaseAdmin
    .from('character_market_value')
    .select('*, character:characters( id, name, image_url )')
    .order('value_score', { ascending: false })
    .limit(50);

  if (error) return [];
  const board = (data ?? []) as unknown as CharacterMarketValue[];
  try { await redis.set(CACHE.leaderboard, board, { ex: TTL.leaderboard }); } catch { /* ok */ }
  return board.slice(0, limit);
}

// ── Signal collection ────────────────────────────────────────────────────────

async function collectSignals(characterId: string): Promise<MarketValueSignals> {
  const [char, conversations, gifts] = await Promise.all([
    supabaseAdmin
      .from('characters')
      .select('like_count, follower_count, total_swipes')
      .eq('id', characterId)
      .single(),
    supabaseAdmin
      .from('conversations')
      .select('id, user_id, last_message_at')
      .eq('character_id', characterId),
    supabaseAdmin
      .from('dating_gifts')
      .select('id', { count: 'exact', head: true })
      .eq('character_id', characterId),
  ]);

  const convos = conversations.data ?? [];
  const uniqueChatters = new Set(convos.map(c => c.user_id)).size;

  let messageVolume = 0;
  if (convos.length) {
    const { count } = await supabaseAdmin
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .in('conversation_id', convos.map(c => c.id));
    messageVolume = count ?? 0;
  }

  // Recency: most recent activity across all conversations, decayed over 60 days.
  const lastActive = convos
    .map(c => c.last_message_at ? new Date(c.last_message_at).getTime() : 0)
    .reduce((max, t) => Math.max(max, t), 0);
  const daysSinceActive = lastActive ? (Date.now() - lastActive) / 86_400_000 : 999;
  const recencyFactor = Math.max(0.15, 1 - daysSinceActive / 60);

  return {
    like_count:      char.data?.like_count ?? 0,
    follower_count:  char.data?.follower_count ?? 0,
    total_swipes:    char.data?.total_swipes ?? 0,
    unique_chatters: uniqueChatters,
    message_volume:  messageVolume,
    gifts_received:  gifts.count ?? 0,
    recency_factor:  Math.round(recencyFactor * 100) / 100,
  };
}

function scoreFromSignals(s: MarketValueSignals): number {
  const raw =
    s.like_count      * WEIGHTS.like +
    s.follower_count  * WEIGHTS.follow +
    s.total_swipes    * WEIGHTS.swipe +
    s.unique_chatters * WEIGHTS.unique_chatter +
    s.message_volume  * WEIGHTS.message +
    s.gifts_received  * WEIGHTS.gift;

  // Recency modulates the score rather than gating it — a dormant but
  // once-beloved character still holds most of its value, doesn't collapse.
  return Math.round(raw * (0.6 + 0.4 * s.recency_factor));
}

// ── Tick: recompute for the whole active roster ────────────────────────────────

export async function tickMarketValue(): Promise<MarketValueTickResult> {
  const { data: characters } = await supabaseAdmin
    .from('characters')
    .select('id')
    .eq('active', true)
    .limit(500);

  if (!characters?.length) return { characters_evaluated: 0, tier_changes: 0 };

  const scored: { character_id: string; score: number }[] = [];
  for (const c of characters) {
    const signals = await collectSignals(c.id);
    scored.push({ character_id: c.id, score: scoreFromSignals(signals) });
    // Stash signals alongside score for the write pass below.
    (scored[scored.length - 1] as { signals?: MarketValueSignals }).signals = signals;
  }

  scored.sort((a, b) => a.score - b.score);
  const n = scored.length;

  let tierChanges = 0;

  // Assign percentile first, then rarity honoring both the percentile floor
  // and the population cap for each tier (checked from rarest down).
  const tierOrder: RarityTier[] = ['mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common'];
  const tierCounts: Record<RarityTier, number> = {
    common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0, mythic: 0,
  };

  for (let i = n - 1; i >= 0; i--) {
    const entry = scored[i]!;
    const percentile = n > 1 ? Math.round(((i + 1) / n) * 1000) / 10 : 100;

    let tier: RarityTier = 'common';
    for (const t of tierOrder) {
      const meetsPercentile = percentile >= RARITY_TIER_PERCENTILE_FLOOR[t];
      const capRoom = tierCounts[t] < Math.max(1, Math.floor(n * RARITY_TIER_POPULATION_CAP[t]));
      if (meetsPercentile && capRoom) { tier = t; break; }
    }
    tierCounts[tier]++;

    const { data: existing } = await supabaseAdmin
      .from('character_market_value')
      .select('rarity_tier, value_history')
      .eq('character_id', entry.character_id)
      .maybeSingle();

    const previousTier = existing?.rarity_tier as RarityTier | undefined;
    const history = Array.isArray(existing?.value_history) ? existing.value_history : [];
    const newHistory = [...history, { at: new Date().toISOString(), score: entry.score, tier }].slice(-30);

    await supabaseAdmin.from('character_market_value').upsert({
      character_id:  entry.character_id,
      value_score:   entry.score,
      percentile,
      rarity_tier:   tier,
      previous_tier: previousTier ?? null,
      value_history: newHistory,
      signals:       (entry as { signals?: MarketValueSignals }).signals ?? {},
      computed_at:   new Date().toISOString(),
    }, { onConflict: 'character_id' });

    if (previousTier && previousTier !== tier) tierChanges++;
  }

  try {
    await redis.del(CACHE.leaderboard);
  } catch { /* ok */ }

  logger.info('market-value:tick:complete', { evaluated: n, tierChanges });
  return { characters_evaluated: n, tier_changes: tierChanges };
}

// ── Prompt / UI helpers ─────────────────────────────────────────────────────────

export function formatValueForPrompt(mv: CharacterMarketValue | null): string {
  if (!mv || mv.rarity_tier === 'common') return '';
  const lines = [`[STANDING WITH USERS]`, `You are considered ${mv.rarity_tier} — genuinely sought after.`];
  return lines.join(' ');
}

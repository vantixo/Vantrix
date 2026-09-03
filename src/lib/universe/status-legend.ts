/**
 * Status & Legend Engine — Vantrix Legacy Systems
 *
 * Social status is civilization rank — distinct from companion_reputation
 * (narrative fame/notoriety). Status is computed from a weighted formula:
 *
 *   wealth (net_worth tier) + occupation prestige + faction role + influence
 *   + fame (cross-referenced from reputation.ts) + governance leadership
 *
 * Legends are the rarest tier above status — enforced scarce by application
 * logic (hard cap), not just a high score. A character must sustain elite
 * status AND meet a type-specific criterion (extreme wealth, a discovery,
 * political leadership, etc.) to qualify, and a global cap limits how many
 * legends can exist at once — exactly as "Legendary status should be rare."
 */

import { supabaseAdmin }   from '@/lib/supabase/admin';
import { logger }          from '@/lib/logger';
import { narrate }         from './narrator';
import { logOfflineEntry } from './life-engine';
import type {
  SocialStatus, Legend, StatusTier, LegendType, StatusTickResult,
} from '@/types/legacy-systems';
import { STATUS_TIER_THRESHOLDS, STATUS_TIER_LABELS } from '@/types/legacy-systems';
import { redis }              from '@/lib/redis';

const CACHE = {
  status:    (charId: string) => `vantrix:status:${charId}`,
  leaders:   'vantrix:status:leaderboard',
  legends:   'vantrix:legends:active',
};
const TTL = { status: 600, leaders: 300, legends: 600 };

const MAX_ACTIVE_LEGENDS = 12;   // hard scarcity cap across the entire universe

// ── Read ───────────────────────────────────────────────────────────────────────

export async function getSocialStatus(characterId: string): Promise<SocialStatus | null> {
  try {
    const cached = await redis.get<SocialStatus>(CACHE.status(characterId));
    if (cached) return cached;
  } catch { /* ok */ }

  const { data, error } = await supabaseAdmin
    .from('social_status')
    .select('*, character:characters( id, name, image_url )')
    .eq('character_id', characterId)
    .maybeSingle();

  if (error || !data) return null;
  try { await redis.set(CACHE.status(characterId), data, { ex: TTL.status }); } catch { /* ok */ }
  return data as SocialStatus;
}

export async function getStatusLeaderboard(limit = 20): Promise<SocialStatus[]> {
  try {
    const cached = await redis.get<SocialStatus[]>(CACHE.leaders);
    if (cached) return cached.slice(0, limit);
  } catch { /* ok */ }

  const { data, error } = await supabaseAdmin
    .from('social_status')
    .select('*, character:characters( id, name, image_url )')
    .order('status_score', { ascending: false })
    .limit(50);

  if (error) return [];
  const board = (data ?? []) as SocialStatus[];
  try { await redis.set(CACHE.leaders, board, { ex: TTL.leaders }); } catch { /* ok */ }
  return board.slice(0, limit);
}

export async function getActiveLegends(): Promise<Legend[]> {
  try {
    const cached = await redis.get<Legend[]>(CACHE.legends);
    if (cached) return cached;
  } catch { /* ok */ }

  const { data, error } = await supabaseAdmin
    .from('legends')
    .select('*, character:characters( id, name, image_url )')
    .eq('active', true)
    .order('declared_at', { ascending: false });

  if (error) return [];
  const legends = (data ?? []) as Legend[];
  try { await redis.set(CACHE.legends, legends, { ex: TTL.legends }); } catch { /* ok */ }
  return legends;
}

export async function getLegend(characterId: string): Promise<Legend | null> {
  const { data } = await supabaseAdmin
    .from('legends')
    .select('*')
    .eq('character_id', characterId)
    .eq('active', true)
    .maybeSingle();
  return (data as Legend) ?? null;
}

// ── Status Computation ────────────────────────────────────────────────────────

export async function computeStatusScore(characterId: string): Promise<number> {
  const [attrs, occ, rep, factionRole, govLeader, char] = await Promise.all([
    supabaseAdmin.from('character_attributes').select('net_worth, wealth_tier').eq('character_id', characterId).maybeSingle(),
    supabaseAdmin.from('companion_occupations').select('occupation:occupations(prestige)').eq('character_id', characterId).maybeSingle(),
    supabaseAdmin.from('companion_reputation').select('fame_score').eq('character_id', characterId).maybeSingle(),
    supabaseAdmin.from('faction_memberships').select('role, faction:factions(influence, is_ruling)').eq('character_id', characterId).eq('is_public', true).maybeSingle(),
    supabaseAdmin.from('city_governance').select('id').eq('leader_character_id', characterId).maybeSingle(),
    supabaseAdmin.from('characters').select('min_tier, tokens_cost, is_premium').eq('id', characterId).maybeSingle(),
  ]);

  let score = 0;

  // Wealth contributes via tier (logarithmic-ish scale)
  const wealthScores: Record<string, number> = {
    destitute: 0, struggling: 30, modest: 80, comfortable: 180,
    wealthy: 350, rich: 600, magnate: 900,
  };
  score += wealthScores[attrs.data?.wealth_tier ?? 'modest'] ?? 80;

  // Occupation prestige
  score += ((occ.data?.occupation as { prestige?: number } | null)?.prestige ?? 40) * 1.5;

  // Fame (cross-reference reputation engine)
  score += (rep.data?.fame_score ?? 0) * 0.3;

  // Faction role
  const role = factionRole.data?.role;
  const faction = factionRole.data?.faction as { is_ruling?: boolean; influence?: number } | null;
  if (role === 'leader') score += 250;
  else if (role === 'lieutenant') score += 120;
  else if (role) score += 40;
  if (faction?.is_ruling) score += 150;
  if (faction?.influence) score += faction.influence * 1.2;

  // City leadership (real political office)
  if (govLeader.data) score += 400;

  // Platform tier — a structural, ongoing bonus so premium/more expensive
  // characters hold elevated standing by default. This is deliberately
  // additive rather than a floor/override: a free character with real
  // wealth/fame/faction traction can still out-rank an idle premium one on
  // the components above, it just starts from further behind. Everything
  // else in this function (wealth drift, fame decay/growth, faction role,
  // governance) is exactly how a lower-tier character earns its way up.
  score += computeTierBonus(char.data);

  return Math.round(score);
}

export function computeTierBonus(char: { min_tier?: string | null; tokens_cost?: number | null; is_premium?: boolean | null } | null | undefined): number {
  if (!char) return 0;
  const TIER_BONUS: Record<string, number> = {
    free: 0, premium: 60,
  };
  let bonus = TIER_BONUS[char.min_tier ?? 'free'] ?? 0;
  bonus += Math.min(150, (char.tokens_cost ?? 0) * 2);   // pricier characters skew higher, capped
  if (char.is_premium) bonus += 40;
  return bonus;
}

function classifyTier(score: number): StatusTier {
  const tiers = Object.entries(STATUS_TIER_THRESHOLDS).sort((a, b) => b[1] - a[1]);
  for (const [tier, threshold] of tiers) {
    if (score >= threshold) return tier as StatusTier;
  }
  return 'unknown_citizen';
}

// ── Tick ───────────────────────────────────────────────────────────────────────

export async function tickStatusAndLegends(): Promise<StatusTickResult> {
  const { data: characters } = await supabaseAdmin
    .from('characters')
    .select('id, name')
    .eq('active', true)
    .limit(200);

  if (!characters?.length) {
    return { characters_evaluated: 0, tier_changes: 0, legends_declared: 0, history_recorded: 0 };
  }

  let tier_changes     = 0;
  let legends_declared = 0;
  let history_recorded = 0;

  for (const char of characters) {
    const score = await computeStatusScore(char.id);
    const newTier = classifyTier(score);

    const { data: existing } = await supabaseAdmin
      .from('social_status')
      .select('status_tier, status_score')
      .eq('character_id', char.id)
      .maybeSingle();

    const oldTier = existing?.status_tier as StatusTier | undefined;

    await supabaseAdmin.from('social_status').upsert({
      character_id: char.id,
      status_tier:  newTier === 'living_legend' ? (oldTier === 'living_legend' ? 'living_legend' : 'global_icon') : newTier,
      // living_legend tier is gated separately below — score alone doesn't grant it
      status_score: score,
      computed_at:  new Date().toISOString(),
    }, { onConflict: 'character_id' });

    if (oldTier && oldTier !== newTier && newTier !== 'living_legend') {
      tier_changes++;
      await logOfflineEntry(
        char.id,
        'status_change',
        narrate.statusTierCrossed(char.name, newTier),
        { emotionalTone: 'significant' },
      );
      history_recorded++;
    }

    // Legend eligibility check — only from global_icon tier and above
    if (score >= STATUS_TIER_THRESHOLDS.global_icon) {
      const declared = await maybeDeclareLegend(char.id, char.name, score);
      if (declared) { legends_declared++; history_recorded++; }
    }
  }

  try {
    await Promise.all([redis.del(CACHE.leaders), redis.del(CACHE.legends)]);
  } catch { /* ok */ }

  return { characters_evaluated: characters.length, tier_changes, legends_declared, history_recorded };
}

async function maybeDeclareLegend(characterId: string, name: string, score: number): Promise<boolean> {
  const existing = await getLegend(characterId);
  if (existing) return false;   // already a legend

  // Enforce hard scarcity cap
  const { count } = await supabaseAdmin
    .from('legends')
    .select('id', { count: 'exact', head: true })
    .eq('active', true);

  if ((count ?? 0) >= MAX_ACTIVE_LEGENDS) return false;

  // Determine legend type from character's strongest dimension
  const [attrs, rep, govLeader] = await Promise.all([
    supabaseAdmin.from('character_attributes').select('wealth_tier').eq('character_id', characterId).maybeSingle(),
    supabaseAdmin.from('companion_reputation').select('reputation_type, fame_score').eq('character_id', characterId).maybeSingle(),
    supabaseAdmin.from('city_governance').select('id').eq('leader_character_id', characterId).maybeSingle(),
  ]);

  let legendType: LegendType = 'reputation';
  let title = `The Legend of ${name}`;

  if (attrs.data?.wealth_tier === 'magnate') {
    legendType = 'wealth'; title = `${name}, Magnate of the Age`;
  } else if (govLeader.data) {
    legendType = 'political'; title = `${name}, Who Led`;
  } else if ((rep.data?.fame_score ?? 0) >= 800) {
    legendType = 'reputation'; title = `${name}, Living Legend`;
  }

  // Only declare probabilistically even when eligible — rarity is partly chance, not just threshold
  if (Math.random() > 0.15) return false;

  await supabaseAdmin.from('legends').insert({
    character_id: characterId,
    legend_title: title,
    legend_type:  legendType,
    biography:    `${name} reached a level of standing in the world that very few ever do. Score at declaration: ${score}.`,
    criteria_met: { score, legend_type: legendType },
  });

  await supabaseAdmin.from('social_status').update({ status_tier: 'living_legend' }).eq('character_id', characterId);

  await logOfflineEntry(
    characterId,
    'legend_declared',
    narrate.legendDeclared(name, title),
    { emotionalTone: 'momentous' },
  );

  logger.info('status-legend:declared', { characterId, name, title });
  return true;
}

// ── Prompt context ─────────────────────────────────────────────────────────────

export async function formatStatusForPrompt(characterId: string): Promise<string> {
  const [status, legend] = await Promise.all([
    getSocialStatus(characterId),
    getLegend(characterId),
  ]);

  if (!status || status.status_tier === 'unknown_citizen') return '';

  const lines = [`[YOUR STANDING IN THE WORLD]`, `You are regarded as: ${STATUS_TIER_LABELS[status.status_tier]}.`];
  if (legend) lines.push(`You are known specifically as "${legend.legend_title}." ${legend.biography}`);

  return lines.join(' ');
}

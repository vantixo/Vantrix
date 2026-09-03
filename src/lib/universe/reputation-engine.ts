/**
 * Reputation Engine — Public Perception
 *
 * "Every citizen knows this person is ___." Six binary public traits —
 * trustworthy, dangerous, famous, dishonest, heroic, rich — derived from
 * signals that already exist across the universe simulation rather than
 * tracked independently:
 *
 *   famous       companion_reputation.fame_score
 *   dangerous    companion_reputation.notoriety_score + reputation_type
 *   rich         character_attributes.wealth_tier / character_market_value
 *   heroic       world_impact_events: sacrifice/milestone weight, reputation_type 'hero'
 *   dishonest    world_impact_events: betrayal count, rupture_unresolved count
 *   trustworthy  world_impact_events: rupture_repaired count, low betrayal, high desire fulfillment
 *
 * A trait becomes public ("every citizen knows") once its score crosses
 * PUBLIC_THRESHOLD — below that it's a private/emerging reputation, still
 * visible via the *_score columns for UI use (e.g. "developing a reputation
 * for dishonesty") but not yet asserted as common knowledge in prompts.
 *
 * This is a read/aggregate layer — it doesn't move the underlying scores
 * (reputation.ts, world-impact.ts, market-value.ts own those). It just
 * distills them into the small set of things a stranger would already
 * "know" about someone before ever meeting them.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';
import { getSocialLinks } from './social-graph';

const PUBLIC_THRESHOLD = 60; // 0-100; score at/above this is common knowledge
const BATCH_LIMIT = 300;

export interface PublicPerception {
  character_id:      string;
  trustworthy:        boolean;
  dangerous:           boolean;
  famous:              boolean;
  dishonest:           boolean;
  heroic:              boolean;
  rich:                boolean;
  trustworthy_score:   number;
  dangerous_score:     number;
  famous_score:        number;
  dishonest_score:     number;
  heroic_score:        number;
  rich_score:          number;
  updated_at:          string;
}

// ── Public: Read ─────────────────────────────────────────────────────────────

export async function getPublicPerception(characterId: string): Promise<PublicPerception | null> {
  const { data, error } = await supabaseAdmin
    .from('character_public_perception')
    .select('*')
    .eq('character_id', characterId)
    .maybeSingle();

  if (error || !data) return null;
  return data as PublicPerception;
}

/** Trait labels currently public knowledge for this character, e.g. ['famous', 'dishonest']. */
export async function getKnownTraits(characterId: string): Promise<string[]> {
  const perception = await getPublicPerception(characterId);
  if (!perception) return [];
  return TRAIT_KEYS.filter((key) => perception[key]);
}

// ── Public: Prompt Formatter ─────────────────────────────────────────────────

/**
 * Formats the character's own known-traits for their system prompt — how
 * the world sees them, which they'd be aware of even if they disagree with it.
 */
export async function formatPublicPerceptionForPrompt(characterId: string): Promise<string> {
  const known = await getKnownTraits(characterId);
  if (known.length === 0) return '';
  return `[How the City Sees You]\nEvery citizen knows you as ${listTraits(known)}.`;
}

/**
 * Formats a *third-party* character's known traits — for injecting into
 * another character's prompt when they reference or think about someone
 * else who has a public reputation. Distinct wording since this is common
 * knowledge, not necessarily this character's own opinion.
 */
export async function formatThirdPartyPerceptionForPrompt(characterId: string, characterName: string): Promise<string> {
  const known = await getKnownTraits(characterId);
  if (known.length === 0) return '';
  return `Word around the city: ${characterName} is known as ${listTraits(known)}.`;
}

/**
 * Formats third-party reputation for the people already in this
 * character's own social circle — the "who's being discussed" signal
 * formatThirdPartyPerceptionForPrompt() needs, sourced from
 * social-graph.ts's companion_social_links rather than guessed. Bounded
 * to the top 3 links by relationship strength (getSocialLinks() already
 * sorts strongest-first) so this stays a handful of small reads, not a
 * fan-out over up to 10 linked characters every prompt assembly.
 */
export async function formatSocialCirclePerceptionForPrompt(characterId: string): Promise<string> {
  const links = await getSocialLinks(characterId);
  if (links.length === 0) return '';

  const top = links.slice(0, 3).filter((l) => l.linked_character?.id && l.linked_character?.name);
  if (top.length === 0) return '';

  const lines = (await Promise.all(
    top.map((l) => formatThirdPartyPerceptionForPrompt(l.linked_character!.id, l.linked_character!.name)),
  )).filter(Boolean);

  if (lines.length === 0) return '';
  return `[Word Around the City — People You Know]\n${lines.join('\n')}`;
}

function listTraits(traits: string[]): string {
  const labels = traits.map((t) => TRAIT_LABELS[t as TraitKey]);
  if (labels.length === 1) return labels[0]!;
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

// ── Public: Tick ──────────────────────────────────────────────────────────────

export interface PerceptionTickResult {
  processed:      number;
  newly_public:   number; // traits that crossed the threshold this tick
}

export async function tickPublicPerception(): Promise<PerceptionTickResult> {
  const { data: characters, error } = await supabaseAdmin
    .from('characters')
    .select('id')
    .limit(BATCH_LIMIT);

  if (error || !characters) {
    logger.warn('reputation-engine:tick:fetch-characters-failed', { error });
    return { processed: 0, newly_public: 0 };
  }

  let newlyPublic = 0;

  await Promise.allSettled(
    characters.map(async (c) => {
      const before = await getPublicPerception(c.id);
      const scores = await computeScores(c.id);
      const traits = deriveTraits(scores);

      if (before) {
        for (const key of TRAIT_KEYS) {
          if (traits[key] && !before[key]) newlyPublic++;
        }
      } else {
        newlyPublic += TRAIT_KEYS.filter((key) => traits[key]).length;
      }

      await supabaseAdmin.from('character_public_perception').upsert(
        {
          character_id:      c.id,
          ...traits,
          trustworthy_score: scores.trustworthy,
          dangerous_score:   scores.dangerous,
          famous_score:      scores.famous,
          dishonest_score:   scores.dishonest,
          heroic_score:      scores.heroic,
          rich_score:        scores.rich,
          updated_at:        new Date().toISOString(),
        },
        { onConflict: 'character_id' },
      );
    }),
  );

  return { processed: characters.length, newly_public: newlyPublic };
}

// ── Internal: Score computation ──────────────────────────────────────────────

interface TraitScores {
  trustworthy: number;
  dangerous:   number;
  famous:      number;
  dishonest:   number;
  heroic:      number;
  rich:        number;
}

const WEALTH_TIER_SCORE: Record<string, number> = {
  destitute: 0, struggling: 10, modest: 25, comfortable: 45, wealthy: 70, rich: 90, magnate: 100,
};

async function computeScores(characterId: string): Promise<TraitScores> {
  const [{ data: rep }, { data: attrs }, { data: mv }, { data: impacts }] = await Promise.all([
    supabaseAdmin.from('companion_reputation').select('fame_score, notoriety_score, reputation_type').eq('character_id', characterId).maybeSingle(),
    supabaseAdmin.from('character_attributes').select('wealth_tier').eq('character_id', characterId).maybeSingle(),
    supabaseAdmin.from('character_market_value').select('percentile').eq('character_id', characterId).maybeSingle(),
    supabaseAdmin.from('world_impact_events').select('source, weight').eq('character_id', characterId).limit(100),
  ]);

  const famous = clamp((rep?.fame_score ?? 0) / 10, 0, 100);
  const dangerousBase = clamp((rep?.notoriety_score ?? 0) / 10, 0, 100);
  const dangerous = rep?.reputation_type === 'villain' ? clamp(dangerousBase + 15, 0, 100) : dangerousBase;

  const richFromWealth = WEALTH_TIER_SCORE[attrs?.wealth_tier ?? 'modest'] ?? 25;
  const richFromMarket = mv?.percentile ?? 0;
  const rich = clamp(Math.max(richFromWealth, richFromMarket), 0, 100);

  const events = impacts ?? [];
  const betrayals = events.filter((e) => e.source === 'betrayal' || e.source === 'rupture_unresolved');
  const repairs   = events.filter((e) => e.source === 'rupture_repaired');
  const heroicEvents = events.filter((e) => e.source === 'sacrifice' || e.source === 'milestone');

  const dishonest = clamp(betrayals.reduce((sum, e) => sum + (e.weight ?? 20), 0) / 3, 0, 100);
  const trustworthyBase = clamp(repairs.reduce((sum, e) => sum + (e.weight ?? 15), 0) / 3, 0, 100);
  const trustworthy = clamp(trustworthyBase - dishonest * 0.5, 0, 100);
  const heroicBase = clamp(heroicEvents.reduce((sum, e) => sum + (e.weight ?? 20), 0) / 3, 0, 100);
  const heroic = rep?.reputation_type === 'hero' ? clamp(heroicBase + 15, 0, 100) : heroicBase;

  return { trustworthy, dangerous, famous, dishonest, heroic, rich };
}

function deriveTraits(scores: TraitScores): Record<TraitKey, boolean> {
  return {
    trustworthy: scores.trustworthy >= PUBLIC_THRESHOLD,
    dangerous:   scores.dangerous   >= PUBLIC_THRESHOLD,
    famous:      scores.famous      >= PUBLIC_THRESHOLD,
    dishonest:   scores.dishonest   >= PUBLIC_THRESHOLD,
    heroic:      scores.heroic      >= PUBLIC_THRESHOLD,
    rich:        scores.rich        >= PUBLIC_THRESHOLD,
  };
}

// ── Shared ────────────────────────────────────────────────────────────────────

type TraitKey = 'trustworthy' | 'dangerous' | 'famous' | 'dishonest' | 'heroic' | 'rich';
const TRAIT_KEYS: TraitKey[] = ['trustworthy', 'dangerous', 'famous', 'dishonest', 'heroic', 'rich'];
const TRAIT_LABELS: Record<TraitKey, string> = {
  trustworthy: 'trustworthy',
  dangerous:   'dangerous',
  famous:      'famous',
  dishonest:   'dishonest',
  heroic:      'heroic',
  rich:        'rich',
};

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

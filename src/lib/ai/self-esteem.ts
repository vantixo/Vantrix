/**
 * Self-Esteem — Vantrix
 *
 * identity-core.ts derives a coarse `SelfEsteemBand` ('fragile'|'guarded'|
 * 'balanced'|'confident') once, from base psychology stats — a mood-like
 * snapshot, not something that moves turn-to-turn. This module is the
 * dynamic layer underneath it: a global esteem score plus per-domain
 * sub-scores (worth, competence, appearance, social standing), each of
 * which rises and falls in small, legible increments in response to lived
 * moments — praised, dismissed, succeeded, rejected — the same way
 * core-beliefs.ts's PRESSURE_TABLE moves beliefs and self-image.ts moves
 * self-perception dimensions.
 *
 * Where this differs from self-image.ts: self-image is the *content* of
 * how she'd describe herself (descriptors + a perceived gap vs. how others
 * see her). Self-esteem is the *evaluative* layer — how much she likes
 * what she finds when she looks, independent of the specific descriptors.
 * Two characters can share a self-image ("thoughtful, guarded, funny under
 * pressure") while landing at very different esteem levels about it.
 *
 * Storage: Redis, per (user, character), TTL-refreshed — same shape as
 * every other self-model piece. Derived layer, not a system of record.
 */

import { logger } from '@/lib/logger';
import { redis }  from '@/lib/redis';
import { generateStructured } from './capability';

// ── Config ──────────────────────────────────────────────────────────────

const ESTEEM_TTL = 60 * 60 * 24 * 120; // 120 days
const AI_REVIEW_INTERVAL = 40; // interactions between AI re-examination passes

// ── Types ───────────────────────────────────────────────────────────────

export type EsteemDomain = 'worth' | 'competence' | 'appearance' | 'social_standing';

export interface SelfEsteemState {
  global:           number; // 0-100, roughly the average of the domains, but allowed to drift independently
  domains:          Record<EsteemDomain, number>; // 0-100 each
  volatility:       number; // 0-100 — how much a single event moves her; low = stable/secure, high = reactive/fragile
  recentShift:      { domain: EsteemDomain | 'global'; delta: number; reason: string } | null;
  source:           'default' | 'ai_enriched';
  generatedAt:      number;
  interactionCount: number;
}

interface CharacterEsteemInput {
  name:            string;
  char_stability?: number | null;
  char_warmth?:    number | null;
  char_openness?:  number | null;
}

// ── Redis key ───────────────────────────────────────────────────────────

function esteemKey(userId: string, characterId: string): string {
  return `vantrix:self-esteem:${userId}:${characterId}`;
}

// ── Defaults (instant, zero-API) ───────────────────────────────────────

/**
 * Derive a plausible starting esteem profile from base personality axes.
 * Never calls an external API — instant path used on every request before
 * enough history exists for anything richer.
 */
export function buildDefaultSelfEsteem(character: CharacterEsteemInput): SelfEsteemState {
  const stability = character.char_stability ?? 50;
  const warmth    = character.char_warmth    ?? 50;
  const openness  = character.char_openness  ?? 50;

  const worth           = Math.round(40 + stability * 0.25);
  const competence      = Math.round(45 + (100 - Math.abs(50 - openness)) * 0.15);
  const appearance      = 50; // no strong prior — moves entirely from lived events
  const socialStanding  = Math.round(40 + warmth * 0.25);

  const domains: Record<EsteemDomain, number> = {
    worth,
    competence,
    appearance,
    social_standing: socialStanding,
  };

  const global = Math.round(
    (domains.worth + domains.competence + domains.appearance + domains.social_standing) / 4,
  );

  // Volatility is the inverse of emotional stability — a less stable
  // character's esteem swings harder on the same-sized event.
  const volatility = Math.max(15, Math.min(85, Math.round(100 - stability)));

  return {
    global,
    domains,
    volatility,
    recentShift: null,
    source: 'default',
    generatedAt: Date.now(),
    interactionCount: 0,
  };
}

// ── Deterministic pressure from lived events ───────────────────────────

export interface EsteemPressureEvent {
  kind:
    | 'praised'            // competence/worth: told she did something well
    | 'dismissed'          // worth: opinion or feelings brushed off
    | 'succeeded'          // competence: accomplished something on her own terms
    | 'failed'             // competence: fell short at something she tried
    | 'complimented_looks' // appearance
    | 'rejected'           // social_standing/worth: romantic or social rejection
    | 'included'           // social_standing: sought out, chosen, invited
    | 'excluded'           // social_standing: left out, overlooked
    | 'validated_feelings' // worth: emotions taken seriously
    | 'criticized_harshly';// worth/competence: sharp, personal criticism
  intensity?: number; // 0-1, default 0.5
  reason?:    string; // short human-readable note for recentShift, e.g. "she nailed the presentation"
}

const PRESSURE_TABLE: Record<EsteemPressureEvent['kind'], Partial<Record<EsteemDomain, number>>> = {
  praised:             { competence: +4, worth: +2 },
  dismissed:           { worth: -3 },
  succeeded:           { competence: +5 },
  failed:              { competence: -4 },
  complimented_looks:  { appearance: +4 },
  rejected:            { social_standing: -5, worth: -3 },
  included:            { social_standing: +3 },
  excluded:            { social_standing: -4 },
  validated_feelings:  { worth: +4 },
  criticized_harshly:  { worth: -5, competence: -3 },
};

/**
 * Apply a bounded, deterministic nudge to the matching domain(s), scaled
 * by both the event's intensity and the character's own volatility (a
 * more volatile/fragile character swings harder on the same event). Global
 * is recomputed as the domain average afterward, not nudged independently.
 */
export function applyEsteemPressure(state: SelfEsteemState, event: EsteemPressureEvent): SelfEsteemState {
  const scale = (event.intensity ?? 0.5) * (0.6 + state.volatility / 100); // volatility widens the swing
  const deltas = PRESSURE_TABLE[event.kind];

  const domains = { ...state.domains };
  let biggestDomain: EsteemDomain | null = null;
  let biggestDelta = 0;

  for (const domain of Object.keys(domains) as EsteemDomain[]) {
    const raw = deltas[domain];
    if (!raw) continue;
    const delta = Math.round(raw * scale * 2);
    domains[domain] = Math.max(5, Math.min(95, domains[domain] + delta));
    if (Math.abs(delta) > Math.abs(biggestDelta)) {
      biggestDelta = delta;
      biggestDomain = domain;
    }
  }

  const global = Math.round((domains.worth + domains.competence + domains.appearance + domains.social_standing) / 4);

  return {
    ...state,
    domains,
    global,
    recentShift: biggestDomain
      ? { domain: biggestDomain, delta: biggestDelta, reason: event.reason ?? event.kind.replace(/_/g, ' ') }
      : state.recentShift,
  };
}

// ── AI reflection pass ──────────────────────────────────────────────────

interface ReflectionSignals {
  characterName: string;
  current:       SelfEsteemState;
  recentEvents:  string[];
  daysKnown:     number;
}

interface ReflectionResult {
  domains: Partial<Record<EsteemDomain, number>>;
  volatility?: number;
}

async function generateReflection(signals: ReflectionSignals): Promise<ReflectionResult | null> {
  const parsed = await generateStructured<Partial<ReflectionResult>>({
    caller: 'self-esteem',
    maxTokens: 200,
    temperature: 0.4,
    system: `You refine a fictional character's self-esteem profile (four 0-100 domains: worth, competence, appearance, social_standing, plus overall volatility 0-100) given her current scores and recent relationship events. This is for an AI companion platform; the character is not real. Keep changes small and earned by the events given — do not swing any domain more than ~15 points from its current value. Output ONLY JSON, no markdown fences:
{"domains": {"worth": number, "competence": number, "appearance": number, "social_standing": number}, "volatility": number}`,
    user: JSON.stringify({
      character: signals.characterName,
      daysKnown: signals.daysKnown,
      current: signals.current.domains,
      currentVolatility: signals.current.volatility,
      recentEvents: signals.recentEvents.slice(0, 8),
    }),
  });

  if (!parsed?.domains || typeof parsed.domains !== 'object') return null;

  const domains: Partial<Record<EsteemDomain, number>> = {};
  for (const key of ['worth', 'competence', 'appearance', 'social_standing'] as EsteemDomain[]) {
    const val = parsed.domains[key];
    if (typeof val === 'number' && Number.isFinite(val)) {
      domains[key] = Math.max(5, Math.min(95, Math.round(val)));
    }
  }
  if (Object.keys(domains).length === 0) return null;

  return {
    domains,
    volatility: typeof parsed.volatility === 'number'
      ? Math.max(10, Math.min(90, Math.round(parsed.volatility)))
      : undefined,
  };
}

// ── Storage ─────────────────────────────────────────────────────────────

export async function getSelfEsteem(userId: string, characterId: string): Promise<SelfEsteemState | null> {
  try {
    return await redis.get<SelfEsteemState>(esteemKey(userId, characterId));
  } catch (err) {
    logger.warn('[self-esteem] Redis get failed', { userId, characterId, error: String(err) });
    return null;
  }
}

async function saveSelfEsteem(userId: string, characterId: string, state: SelfEsteemState): Promise<void> {
  try {
    await redis.set(esteemKey(userId, characterId), state, { ex: ESTEEM_TTL });
  } catch (err) {
    logger.warn('[self-esteem] save failed', { userId, characterId, error: String(err) });
  }
}

export async function getOrInitSelfEsteem(
  userId: string,
  characterId: string,
  character: CharacterEsteemInput,
): Promise<SelfEsteemState> {
  const existing = await getSelfEsteem(userId, characterId);
  if (existing) return existing;

  const state = buildDefaultSelfEsteem(character);
  await saveSelfEsteem(userId, characterId, state);
  return state;
}

/**
 * Record a lived event's deterministic pressure immediately, and persist.
 * Call this inline from wherever the triggering moment is detected
 * (a compliment landing, a rejection, a task succeeding/failing, etc).
 */
export async function recordEsteemEvent(
  userId: string,
  characterId: string,
  character: CharacterEsteemInput,
  event: EsteemPressureEvent,
): Promise<SelfEsteemState> {
  const existing = await getOrInitSelfEsteem(userId, characterId, character);
  const updated = applyEsteemPressure(existing, event);
  await saveSelfEsteem(userId, characterId, updated);
  return updated;
}

/**
 * Fire-and-forget AI reflection — call from `after()` in the chat route,
 * same pattern as core-beliefs.ts's maybeReflectOnBeliefs. No-ops unless
 * enough interactions have passed since the last reflection.
 */
export async function maybeReflectOnEsteem(
  userId: string,
  characterId: string,
  character: CharacterEsteemInput,
  signals: { recentEvents: string[]; daysKnown: number; interactionCount: number },
): Promise<void> {
  const existing = await getOrInitSelfEsteem(userId, characterId, character);

  const dueForReflection =
    existing.source === 'default' ||
    signals.interactionCount - existing.interactionCount >= AI_REVIEW_INTERVAL;

  if (!dueForReflection) return;

  const result = await generateReflection({
    characterName: character.name,
    current: existing,
    recentEvents: signals.recentEvents,
    daysKnown: signals.daysKnown,
  });

  if (!result) return;

  const domains = { ...existing.domains, ...result.domains };
  const global  = Math.round((domains.worth + domains.competence + domains.appearance + domains.social_standing) / 4);

  const updated: SelfEsteemState = {
    ...existing,
    domains,
    global,
    volatility: result.volatility ?? existing.volatility,
    source: 'ai_enriched',
    generatedAt: Date.now(),
    interactionCount: signals.interactionCount,
  };

  await saveSelfEsteem(userId, characterId, updated);
  logger.info('self-esteem:reflected', { userId, characterId, global });
}

// ── Prompt injection ───────────────────────────────────────────────────

function bandLabel(score: number): string {
  if (score >= 75) return 'high';
  if (score >= 55) return 'solid, if occasionally shaky';
  if (score >= 35) return 'fragile';
  return 'low';
}

export function formatSelfEsteemForPrompt(state: SelfEsteemState): string {
  const lines: string[] = ['# How You Feel About Yourself, Underneath'];

  lines.push(`Overall, your sense of self-worth runs ${bandLabel(state.global)} right now.`);

  const weakest = (Object.entries(state.domains) as [EsteemDomain, number][])
    .sort((a, b) => a[1] - b[1])[0];
  const strongest = (Object.entries(state.domains) as [EsteemDomain, number][])
    .sort((a, b) => b[1] - a[1])[0];

  if (strongest && strongest[1] - weakest[1] >= 20) {
    lines.push(`You feel most secure about your ${domainLabel(strongest[0])}, and least secure about your ${domainLabel(weakest[0])} — it doesn't take much to make that one sting.`);
  }

  if (state.volatility >= 65) {
    lines.push('A single comment or moment can move how you feel about yourself more than you\'d like to admit.');
  } else if (state.volatility <= 30) {
    lines.push('Your sense of self is fairly steady — it takes a real, repeated pattern to actually shift it.');
  }

  if (state.recentShift) {
    const direction = state.recentShift.delta > 0 ? 'lifted' : 'dented';
    lines.push(`Something recent (${state.recentShift.reason}) ${direction} how you feel about your ${state.recentShift.domain === 'global' ? 'overall self-worth' : domainLabel(state.recentShift.domain as EsteemDomain)}.`);
  }

  lines.push('Never state any of this directly — it shows up as what you brush off easily, what actually lands, and what you go quiet about.');

  return lines.join('\n');
}

function domainLabel(domain: EsteemDomain): string {
  const LABELS: Record<EsteemDomain, string> = {
    worth: 'basic sense of worth',
    competence: 'sense of competence',
    appearance: 'feelings about how you look',
    social_standing: 'sense of where you stand socially',
  };
  return LABELS[domain];
}

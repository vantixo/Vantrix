/**
 * Core Beliefs — Vantrix
 *
 * Beneath a character's stated values (personal-values.ts) sit deeper,
 * mostly-unconscious beliefs: assumptions about whether people leave,
 * whether she is "too much," whether the world rewards effort. Values are
 * what she'd tell you she stands for; core beliefs are what she'd never
 * think to say out loud because she doesn't experience them as beliefs at
 * all — just as how things are.
 *
 * Beliefs form in three ways here:
 *   1. Seeded instantly from base personality axes (zero API calls) — same
 *      "default now, enrich later" shape as identity-core.ts.
 *   2. Nudged by lived relationship events (ruptures, repairs, abandonment
 *      signals) via `applyBeliefPressure` — small, bounded, deterministic.
 *   3. Periodically re-examined by a cheap AI pass that can surface a belief
 *      the deterministic nudges alone wouldn't catch, and can occasionally
 *      soften or challenge a belief the character is actively growing past.
 *
 * Storage: Redis, per (user, character), TTL-refreshed — mirrors
 * identity-core.ts exactly. This is a derived layer, not a system of record.
 */

import { generateStructured } from './capability';
import { logger } from '@/lib/logger';
import { redis }  from '@/lib/redis';

// ── Config ──────────────────────────────────────────────────────────────

const BELIEFS_TTL = 60 * 60 * 24 * 120; // 120 days
const AI_REVIEW_INTERVAL = 40; // interactions between AI re-examination passes

// ── Types ───────────────────────────────────────────────────────────────

export type BeliefDomain = 'self-worth' | 'trust' | 'connection' | 'competence' | 'world';

export interface CoreBelief {
  id:          string;          // stable slug, e.g. "trust-must-be-earned-slowly"
  domain:      BeliefDomain;
  statement:   string;          // first-person framing, private, never recited
  strength:    number;          // 0-100 — how deeply held right now
  origin:      'seeded' | 'experience' | 'ai_reflection';
  lastUpdated: number;
}

export interface CoreBeliefSet {
  beliefs:          CoreBelief[]; // 3-6
  source:           'default' | 'ai_enriched';
  generatedAt:      number;
  interactionCount: number;
}

interface CharacterBeliefInput {
  name:            string;
  char_openness?:  number | null;
  char_warmth?:    number | null;
  char_stability?: number | null; // emotional stability axis, if present
}

// ── Redis key ───────────────────────────────────────────────────────────

function beliefsKey(userId: string, characterId: string): string {
  return `vantrix:core-beliefs:${userId}:${characterId}`;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 48);
}

// ── Seeded defaults (instant) ──────────────────────────────────────────

function seedBelief(domain: BeliefDomain, statement: string, strength: number): CoreBelief {
  return {
    id: slugify(statement),
    domain,
    statement,
    strength,
    origin: 'seeded',
    lastUpdated: Date.now(),
  };
}

/**
 * Derive a small, plausible starting set of core beliefs from the
 * character's base personality axes. Never calls an external API — this is
 * the instant path used on every request before enough history exists for
 * anything richer.
 */
export function buildDefaultCoreBeliefs(character: CharacterBeliefInput): CoreBeliefSet {
  const warmth    = character.char_warmth    ?? 50;
  const openness  = character.char_openness  ?? 50;
  const stability = character.char_stability ?? 50;

  const beliefs: CoreBelief[] = [];

  beliefs.push(
    warmth >= 60
      ? seedBelief('connection', 'if I show up for people, most of them will show up for me too', 55)
      : seedBelief('connection', 'people mostly show up for you when it\'s convenient for them', 45),
  );

  beliefs.push(
    openness >= 60
      ? seedBelief('trust', 'being open with someone is worth the risk of getting hurt', 50)
      : seedBelief('trust', 'trust has to be earned slowly, in small tested steps', 60),
  );

  beliefs.push(
    stability >= 60
      ? seedBelief('self-worth', 'my worth doesn\'t depend on any one person staying', 55)
      : seedBelief('self-worth', 'if someone important pulls away, it probably says something true about me', 50),
  );

  beliefs.push(seedBelief('competence', 'I can handle more than people give me credit for', 50));
  beliefs.push(seedBelief('world', 'most things work out if you keep showing up honestly', 45));

  return {
    beliefs,
    source: 'default',
    generatedAt: Date.now(),
    interactionCount: 0,
  };
}

// ── Deterministic pressure from lived events ───────────────────────────

export interface BeliefPressureEvent {
  kind: 'abandonment_signal' | 'reliable_presence' | 'boundary_respected' | 'boundary_violated' | 'validated' | 'dismissed';
  intensity?: number; // 0-1, default 0.5
}

const PRESSURE_TABLE: Record<BeliefPressureEvent['kind'], Partial<Record<BeliefDomain, number>>> = {
  abandonment_signal:  { connection: -4, 'self-worth': -3 },
  reliable_presence:   { connection: +3, trust: +2 },
  boundary_respected:  { trust: +3 },
  boundary_violated:   { trust: -5, 'self-worth': -2 },
  validated:           { 'self-worth': +3, competence: +2 },
  dismissed:           { 'self-worth': -3 },
};

/**
 * Apply a bounded, deterministic nudge to matching beliefs after a
 * relationship event. Cheap, synchronous, no API call — this is what keeps
 * beliefs feeling earned turn-by-turn between the slower AI reflection
 * passes. Strength is clamped to [5, 95]; beliefs never fully vanish or
 * become absolute.
 */
export function applyBeliefPressure(set: CoreBeliefSet, event: BeliefPressureEvent): CoreBeliefSet {
  const scale = event.intensity ?? 0.5;
  const deltas = PRESSURE_TABLE[event.kind];

  const beliefs = set.beliefs.map((b) => {
    const delta = deltas[b.domain];
    if (!delta) return b;
    const strength = Math.max(5, Math.min(95, Math.round(b.strength + delta * scale * 2)));
    return { ...b, strength, lastUpdated: Date.now() };
  });

  return { ...set, beliefs };
}

// ── AI reflection pass ──────────────────────────────────────────────────

interface ReflectionSignals {
  characterName:     string;
  currentBeliefs:    CoreBelief[];
  recentEvents:      string[]; // short natural-language summaries
  selfEsteemBand?:   string;   // from identity-core, if available
  daysKnown:         number;
}

interface ReflectionResult {
  beliefs: { id?: string; statement: string; domain: BeliefDomain; strength: number }[];
}

async function generateReflection(signals: ReflectionSignals): Promise<ReflectionResult | null> {
  const parsed = await generateStructured<Partial<ReflectionResult>>({
    caller: 'core-beliefs',
    maxTokens: 260,
    temperature: 0.4,
    system: `You refine a fictional character's deep, mostly-unconscious core beliefs (not stated values — private assumptions about self/trust/connection/competence/world) given their current beliefs and recent relationship events. This is for an AI companion platform; the character is not real. Return 3-6 beliefs total, keeping ones still true and adjusting or replacing ones the recent events contradict. Output ONLY JSON, no markdown fences:
{"beliefs": [{"statement": string (first-person, under 100 chars), "domain": "self-worth"|"trust"|"connection"|"competence"|"world", "strength": number (5-95)}]}`,
    user: JSON.stringify({
      character: signals.characterName,
      daysKnown: signals.daysKnown,
      selfEsteemBand: signals.selfEsteemBand,
      currentBeliefs: signals.currentBeliefs.map(b => ({ statement: b.statement, domain: b.domain, strength: b.strength })),
      recentEvents: signals.recentEvents.slice(0, 8),
    }),
  });

  if (!parsed || !Array.isArray(parsed.beliefs)) return null;

  return {
    beliefs: parsed.beliefs
      .filter((b): b is ReflectionResult['beliefs'][number] =>
        typeof b?.statement === 'string' && b.statement.length > 3 && b.statement.length < 140 &&
        typeof b?.domain === 'string' && typeof b?.strength === 'number')
      .slice(0, 6)
      .map(b => ({ ...b, strength: Math.max(5, Math.min(95, Math.round(b.strength))) })),
  };
}

// ── Storage ─────────────────────────────────────────────────────────────

export async function getCoreBeliefs(userId: string, characterId: string): Promise<CoreBeliefSet | null> {
  try {
    return await redis.get<CoreBeliefSet>(beliefsKey(userId, characterId));
  } catch (err) {
    logger.warn('[core-beliefs] Redis get failed', { userId, characterId, error: String(err) });
    return null;
  }
}

async function saveCoreBeliefs(userId: string, characterId: string, set: CoreBeliefSet): Promise<void> {
  try {
    await redis.set(beliefsKey(userId, characterId), set, { ex: BELIEFS_TTL });
  } catch (err) {
    logger.warn('[core-beliefs] save failed', { userId, characterId, error: String(err) });
  }
}

export async function getOrInitCoreBeliefs(
  userId: string,
  characterId: string,
  character: CharacterBeliefInput,
): Promise<CoreBeliefSet> {
  const existing = await getCoreBeliefs(userId, characterId);
  if (existing) return existing;

  const set = buildDefaultCoreBeliefs(character);
  await saveCoreBeliefs(userId, characterId, set);
  return set;
}

/**
 * Record a lived event's deterministic pressure immediately (cheap,
 * synchronous once loaded), and persist. Call this inline from wherever the
 * triggering event is detected (rupture/repair, validation, etc).
 */
export async function recordBeliefEvent(
  userId: string,
  characterId: string,
  character: CharacterBeliefInput,
  event: BeliefPressureEvent,
): Promise<void> {
  const existing = await getOrInitCoreBeliefs(userId, characterId, character);
  const updated = applyBeliefPressure(existing, event);
  await saveCoreBeliefs(userId, characterId, updated);
}

/**
 * Fire-and-forget AI reflection — call from `after()` in the chat route,
 * same pattern as identity-core's maybeRefreshIdentityCore. No-ops unless
 * enough interactions have passed since the last reflection.
 */
export async function maybeReflectOnBeliefs(
  userId: string,
  characterId: string,
  character: CharacterBeliefInput,
  signals: { recentEvents: string[]; selfEsteemBand?: string; daysKnown: number; interactionCount: number },
): Promise<void> {
  const existing = await getOrInitCoreBeliefs(userId, characterId, character);

  const dueForReflection =
    existing.source === 'default' ||
    signals.interactionCount - existing.interactionCount >= AI_REVIEW_INTERVAL;

  if (!dueForReflection) return;

  const result = await generateReflection({
    characterName: character.name,
    currentBeliefs: existing.beliefs,
    recentEvents: signals.recentEvents,
    selfEsteemBand: signals.selfEsteemBand,
    daysKnown: signals.daysKnown,
  });

  if (!result) return;

  const beliefs: CoreBelief[] = result.beliefs.map((b) => ({
    id: slugify(b.statement),
    domain: b.domain,
    statement: b.statement,
    strength: b.strength,
    origin: 'ai_reflection',
    lastUpdated: Date.now(),
  }));

  const updated: CoreBeliefSet = {
    beliefs,
    source: 'ai_enriched',
    generatedAt: Date.now(),
    interactionCount: signals.interactionCount,
  };

  await saveCoreBeliefs(userId, characterId, updated);
  logger.info('core-beliefs:reflected', { userId, characterId, count: beliefs.length });
}

// ── Prompt injection ───────────────────────────────────────────────────

export function formatCoreBeliefsForPrompt(set: CoreBeliefSet): string {
  if (!set.beliefs.length) return '';

  const lines: string[] = ['# Beliefs You Hold Without Thinking About Them'];
  for (const b of set.beliefs) {
    const weight = b.strength >= 70 ? 'deeply' : b.strength >= 40 ? 'mostly' : 'loosely';
    lines.push(`- (${weight} held) ${b.statement}`);
  }
  lines.push('These are assumptions, not opinions — you wouldn\'t state them, they just shape what you notice, what stings, and what you brace for. Let them leak through reactions, never through explanation.');

  return lines.join('\n');
}

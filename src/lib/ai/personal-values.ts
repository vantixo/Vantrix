/**
 * Personal Values — Vantrix
 *
 * identity-core.ts already surfaces a flat `coreValues` list. What's missing
 * is structure: values aren't a flat set, they're ranked, they compete, and
 * a character reveals character precisely in *which* value wins when two of
 * them point in different directions ("I want to be honest" vs "I don't
 * want to hurt her"). This module owns that hierarchy and the conflict
 * resolution logic, and is the thing identity-engine.ts composes together
 * with core-beliefs.ts and self-image.ts.
 *
 * No new authoring surface: seeded from character.values_list like
 * identity-core.ts, ranked heuristically from personality axes, refined
 * only via lightweight, deterministic reordering triggered by which values
 * actually got "used" in a resolved conflict — a value that wins repeatedly
 * climbs the hierarchy; one that's consistently overridden slips.
 */

import { logger } from '@/lib/logger';
import { redis }  from '@/lib/redis';

// ── Config ──────────────────────────────────────────────────────────────

const VALUES_TTL = 60 * 60 * 24 * 120; // 120 days
const RANK_STEP = 3; // how much a value moves per resolved conflict

// ── Types ───────────────────────────────────────────────────────────────

export interface ValueEntry {
  value:    string;   // short phrase, e.g. "honesty", "protecting people she loves"
  priority: number;   // 0-100, higher = wins conflicts more often
  timesWon: number;
  timesLost: number;
}

export interface PersonalValueSet {
  values:           ValueEntry[]; // 3-5, kept sorted by priority desc
  generatedAt:      number;
  interactionCount: number;
}

interface CharacterValuesInput {
  values_list?:    string[] | null;
  char_warmth?:    number | null;
  char_openness?:  number | null;
  char_depth?:     number | null;
}

// ── Redis key ───────────────────────────────────────────────────────────

function valuesKey(userId: string, characterId: string): string {
  return `vantrix:personal-values:${userId}:${characterId}`;
}

// ── Defaults ────────────────────────────────────────────────────────────

const HEURISTIC_VALUE_POOL = (character: CharacterValuesInput): string[] => {
  const warmth = character.char_warmth ?? 50;
  const depth  = character.char_depth  ?? 50;
  const pool: string[] = ['honesty'];
  pool.push(warmth >= 55 ? 'protecting people she cares about' : 'self-respect');
  pool.push(depth >= 55 ? 'real, unperformed connection' : 'keeping things light and easy');
  pool.push('not being someone she'.concat("'d be ashamed of"));
  return pool;
};

/**
 * Build a ranked value hierarchy instantly. Seeds from character.values_list
 * when the creator provided it (preserving their order as initial priority),
 * otherwise falls back to a heuristic pool derived from personality axes.
 */
export function buildDefaultPersonalValues(character: CharacterValuesInput): PersonalValueSet {
  const source = character.values_list?.length
    ? character.values_list.slice(0, 5)
    : HEURISTIC_VALUE_POOL(character).slice(0, 4);

  const values: ValueEntry[] = source.map((value, i) => ({
    value,
    priority: Math.max(30, 80 - i * 15), // first-listed value starts highest
    timesWon: 0,
    timesLost: 0,
  }));

  return {
    values,
    generatedAt: Date.now(),
    interactionCount: 0,
  };
}

function sortByPriority(set: PersonalValueSet): PersonalValueSet {
  return { ...set, values: [...set.values].sort((a, b) => b.priority - a.priority) };
}

// ── Conflict resolution ─────────────────────────────────────────────────

export interface ValueConflict {
  optionA: string; // which existing value's name this situation invokes
  optionB: string;
}

export interface ConflictResolution {
  winner: string;
  loser:  string;
  /** true if neither option matched a known value — caller should treat this as unresolved */
  unresolved: boolean;
}

/**
 * Given two values in tension, resolve which one the character would act
 * on, purely from the current hierarchy. Deterministic, synchronous, no API
 * call — this is meant to run inline while composing a response, not as a
 * background job.
 */
export function resolveValueConflict(set: PersonalValueSet, conflict: ValueConflict): ConflictResolution {
  const a = set.values.find(v => v.value === conflict.optionA);
  const b = set.values.find(v => v.value === conflict.optionB);

  if (!a || !b) {
    return { winner: conflict.optionA, loser: conflict.optionB, unresolved: true };
  }

  return a.priority >= b.priority
    ? { winner: a.value, loser: b.value, unresolved: false }
    : { winner: b.value, loser: a.value, unresolved: false };
}

/**
 * After a conflict actually plays out in the conversation (the character
 * said/did something that favored one value over another), nudge the
 * hierarchy so repeated patterns become self-reinforcing — a value invoked
 * and honored enough times becomes more central; one repeatedly set aside
 * drifts down without ever being deleted (values aren't lost, just
 * deprioritized).
 */
export function applyConflictOutcome(set: PersonalValueSet, resolution: ConflictResolution): PersonalValueSet {
  if (resolution.unresolved) return set;

  const values = set.values.map((v) => {
    if (v.value === resolution.winner) {
      return { ...v, priority: Math.min(100, v.priority + RANK_STEP), timesWon: v.timesWon + 1 };
    }
    if (v.value === resolution.loser) {
      return { ...v, priority: Math.max(10, v.priority - RANK_STEP), timesLost: v.timesLost + 1 };
    }
    return v;
  });

  return sortByPriority({ ...set, values });
}

// ── Storage ─────────────────────────────────────────────────────────────

export async function getPersonalValues(userId: string, characterId: string): Promise<PersonalValueSet | null> {
  try {
    return await redis.get<PersonalValueSet>(valuesKey(userId, characterId));
  } catch (err) {
    logger.warn('[personal-values] Redis get failed', { userId, characterId, error: String(err) });
    return null;
  }
}

async function savePersonalValues(userId: string, characterId: string, set: PersonalValueSet): Promise<void> {
  try {
    await redis.set(valuesKey(userId, characterId), set, { ex: VALUES_TTL });
  } catch (err) {
    logger.warn('[personal-values] save failed', { userId, characterId, error: String(err) });
  }
}

export async function getOrInitPersonalValues(
  userId: string,
  characterId: string,
  character: CharacterValuesInput,
): Promise<PersonalValueSet> {
  const existing = await getPersonalValues(userId, characterId);
  if (existing) return existing;

  const set = sortByPriority(buildDefaultPersonalValues(character));
  await savePersonalValues(userId, characterId, set);
  return set;
}

/**
 * Convenience wrapper: resolve a conflict against stored state, persist the
 * outcome, and return the resolution for the caller (response-planner.ts,
 * decision-engine.ts, etc) to act on.
 */
export async function resolveAndRecordConflict(
  userId: string,
  characterId: string,
  character: CharacterValuesInput,
  conflict: ValueConflict,
): Promise<ConflictResolution> {
  const set = await getOrInitPersonalValues(userId, characterId, character);
  const resolution = resolveValueConflict(set, conflict);
  const updated = applyConflictOutcome(set, resolution);
  updated.interactionCount = set.interactionCount + 1;
  await savePersonalValues(userId, characterId, updated);
  return resolution;
}

// ── Prompt injection ───────────────────────────────────────────────────

export function formatPersonalValuesForPrompt(set: PersonalValueSet): string {
  if (!set.values.length) return '';

  const ranked = [...set.values].sort((a, b) => b.priority - a.priority);
  const lines: string[] = ['# What Actually Wins When Your Values Pull Different Directions'];
  ranked.forEach((v, i) => {
    lines.push(`${i + 1}. ${v.value}`);
  });
  lines.push('When two of these are in tension in a single moment, the higher-ranked one is what you actually do — even if you feel the pull of the other. Never explain this ranking out loud; it should only show in the choice itself.');

  return lines.join('\n');
}

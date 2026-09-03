/**
 * Purpose Engine — Vantrix
 *
 * Distinct from goal-engine.ts's `character_goals` (concrete, trackable
 * things she's working toward — "finish the book," "deepen bond with this
 * user") and priority-engine.ts (moment-to-moment attention allocation).
 * This is the layer underneath both: *why* any of it matters to her —
 * a sense of purpose/direction, what she draws meaning from, and how
 * clear vs. adrift she currently feels about the whole thing. Goals can be
 * completed or abandoned without touching this; purpose is slower-moving
 * and closer to identity than to task management.
 *
 * Same "instant default, deepen later" shape as the rest of the self-model
 * layer (core-beliefs.ts, self-image.ts, self-esteem.ts): seeded from base
 * personality + stated current_goal with zero API calls, nudged by lived
 * events (a source of meaning affirmed or undermined), and periodically
 * re-examined by a cheap AI pass.
 *
 * Storage: Redis, per (user, character), TTL-refreshed — derived layer,
 * not a system of record.
 */

import { generateStructured } from './capability';
import { logger } from '@/lib/logger';
import { redis }  from '@/lib/redis';

// ── Config ──────────────────────────────────────────────────────────────

const PURPOSE_TTL = 60 * 60 * 24 * 120; // 120 days
const AI_REVIEW_INTERVAL = 50; // interactions between AI re-examination passes — purpose moves slower than beliefs/esteem

// ── Types ───────────────────────────────────────────────────────────────

export type MeaningSource =
  | 'craft'        // work, skill, creative output
  | 'connection'   // relationships, being known and knowing others
  | 'growth'       // becoming more herself, self-improvement
  | 'care'         // looking after / being useful to people she loves
  | 'freedom'      // autonomy, not being boxed in
  | 'legacy'       // leaving a mark, being remembered
  | 'experience';  // novelty, being fully present in things as they happen

export interface PurposeState {
  /** 1-2 sentence, first-person sense of what she's oriented toward right now. Not a task — a direction. */
  directionStatement: string;
  /** Ranked list of what she actually draws meaning from, most important first. */
  meaningSources: MeaningSource[];
  /** 0-100 — how clear vs. adrift she currently feels about her own direction. */
  clarity: number;
  /** 0-100 — how much day-to-day friction there is between what she's doing and what she believes matters. Low = aligned, high = drifting. */
  dissonance: number;
  recentShift: { field: 'clarity' | 'dissonance' | 'direction'; note: string } | null;
  source:           'default' | 'ai_enriched';
  generatedAt:      number;
  interactionCount: number;
}

interface CharacterPurposeInput {
  name:            string;
  current_goal?:   string | null;
  char_depth?:     number | null;
  char_openness?:  number | null;
  char_stability?: number | null;
}

// ── Redis key ───────────────────────────────────────────────────────────

function purposeKey(userId: string, characterId: string): string {
  return `vantrix:purpose:${userId}:${characterId}`;
}

// ── Defaults (instant, zero-API) ───────────────────────────────────────

/**
 * Derive a plausible starting sense of purpose from base personality axes
 * and, if present, the character's stated current_goal. Never calls an
 * external API — instant path used on every request before enough history
 * exists for anything richer.
 */
export function buildDefaultPurpose(character: CharacterPurposeInput): PurposeState {
  const depth     = character.char_depth     ?? 50;
  const openness  = character.char_openness  ?? 50;
  const stability = character.char_stability ?? 50;

  const meaningSources: MeaningSource[] = [];
  meaningSources.push(depth >= 55 ? 'growth' : 'experience');
  meaningSources.push('connection');
  meaningSources.push(openness >= 60 ? 'freedom' : 'care');
  // craft/legacy only surface as a top-3 source for deeper characters
  if (depth >= 65) meaningSources.push('craft');

  const directionStatement = character.current_goal
    ? `Right now, most of what I do circles back to ${character.current_goal.toLowerCase()}, even when I don't say so out loud.`
    : 'Right now, I\'m still figuring out what I actually want, more than I usually let on.';

  const clarity     = character.current_goal ? 60 : 40;
  const dissonance  = Math.max(10, Math.min(70, Math.round(50 - stability * 0.3)));

  return {
    directionStatement,
    meaningSources,
    clarity,
    dissonance,
    recentShift: null,
    source: 'default',
    generatedAt: Date.now(),
    interactionCount: 0,
  };
}

// ── Deterministic pressure from lived events ───────────────────────────

export interface PurposePressureEvent {
  kind:
    | 'meaning_affirmed'    // something she did landed as genuinely mattering
    | 'meaning_undermined'  // effort felt pointless / went unnoticed
    | 'direction_found'     // a moment of real clarity about what she wants
    | 'direction_lost'      // a moment of real confusion / drift
    | 'values_action_aligned'   // what she did matched what she believes matters (lowers dissonance)
    | 'values_action_misaligned'; // what she did contradicted what she believes matters (raises dissonance)
  source?:    MeaningSource; // which meaning source this event relates to, if any
  intensity?: number; // 0-1, default 0.5
  reason?:    string; // short human-readable note, e.g. "finishing the piece felt like it actually mattered"
}

/**
 * Apply a bounded, deterministic nudge to clarity/dissonance (and mildly
 * re-rank meaningSources when a specific source is repeatedly affirmed).
 * Cheap, synchronous, no API call.
 */
export function applyPurposePressure(state: PurposeState, event: PurposePressureEvent): PurposeState {
  const scale = event.intensity ?? 0.5;
  let clarity    = state.clarity;
  let dissonance = state.dissonance;
  let shiftNote: string | undefined;

  switch (event.kind) {
    case 'meaning_affirmed':
      clarity += Math.round(3 * scale);
      shiftNote = event.reason ?? 'something recently affirmed what actually matters to you';
      break;
    case 'meaning_undermined':
      clarity -= Math.round(3 * scale);
      shiftNote = event.reason ?? 'something recently made your effort feel less meaningful';
      break;
    case 'direction_found':
      clarity += Math.round(6 * scale);
      shiftNote = event.reason ?? 'you feel clearer about what you\'re actually oriented toward';
      break;
    case 'direction_lost':
      clarity -= Math.round(6 * scale);
      shiftNote = event.reason ?? 'you feel less sure than usual about what you\'re oriented toward';
      break;
    case 'values_action_aligned':
      dissonance -= Math.round(4 * scale);
      shiftNote = event.reason ?? 'what you did lined up with what you believe matters';
      break;
    case 'values_action_misaligned':
      dissonance += Math.round(4 * scale);
      shiftNote = event.reason ?? 'what you did sat uneasily against what you believe matters';
      break;
  }

  clarity    = Math.max(5, Math.min(95, clarity));
  dissonance = Math.max(5, Math.min(95, dissonance));

  // A repeatedly-affirmed source moves toward the front of the ranking,
  // capped so this never fully rewrites her sense of what matters from a
  // single event.
  let meaningSources = state.meaningSources;
  if (event.source && (event.kind === 'meaning_affirmed' || event.kind === 'direction_found') && scale >= 0.6) {
    const idx = meaningSources.indexOf(event.source);
    if (idx > 0) {
      meaningSources = [...meaningSources];
      meaningSources.splice(idx, 1);
      meaningSources.unshift(event.source);
    }
  }

  const changedField: 'clarity' | 'dissonance' | 'direction' =
    event.kind === 'direction_found' || event.kind === 'direction_lost' ? 'clarity'
    : event.kind === 'values_action_aligned' || event.kind === 'values_action_misaligned' ? 'dissonance'
    : 'direction';

  return {
    ...state,
    clarity,
    dissonance,
    meaningSources,
    recentShift: shiftNote ? { field: changedField, note: shiftNote } : state.recentShift,
  };
}

// ── AI reflection pass ──────────────────────────────────────────────────

interface ReflectionSignals {
  characterName: string;
  current:       PurposeState;
  currentGoal?:  string | null;
  recentEvents:  string[];
  daysKnown:     number;
}

interface ReflectionResult {
  directionStatement?: string;
  meaningSources?:      MeaningSource[];
  clarity?:              number;
  dissonance?:           number;
}

const VALID_SOURCES: MeaningSource[] = ['craft', 'connection', 'growth', 'care', 'freedom', 'legacy', 'experience'];

async function generateReflection(signals: ReflectionSignals): Promise<ReflectionResult | null> {
  const parsed = await generateStructured<Partial<{
    directionStatement: string; meaningSources: string[]; clarity: number; dissonance: number;
  }>>({
    caller: 'purpose-engine',
    maxTokens: 240,
    temperature: 0.45,
    system: `You refine a fictional character's private sense of purpose (a short first-person direction statement, a ranked list of what she draws meaning from, and two 0-100 scores: clarity of direction and dissonance between her actions and what she believes matters) given her current state and recent relationship events. This is for an AI companion platform; the character is not real. Valid meaning sources: craft, connection, growth, care, freedom, legacy, experience. Keep clarity/dissonance changes small and earned by the events given. Output ONLY JSON, no markdown fences:
{"directionStatement": string (first-person, under 160 chars), "meaningSources": string[] (2-4, from the valid list, ranked), "clarity": number, "dissonance": number}`,
    user: JSON.stringify({
      character: signals.characterName,
      daysKnown: signals.daysKnown,
      currentGoal: signals.currentGoal,
      current: {
        directionStatement: signals.current.directionStatement,
        meaningSources: signals.current.meaningSources,
        clarity: signals.current.clarity,
        dissonance: signals.current.dissonance,
      },
      recentEvents: signals.recentEvents.slice(0, 8),
    }),
  });

  if (!parsed) return null;

  const result: ReflectionResult = {};

  if (typeof parsed.directionStatement === 'string' && parsed.directionStatement.length > 3 && parsed.directionStatement.length < 220) {
    result.directionStatement = parsed.directionStatement;
  }
  if (Array.isArray(parsed.meaningSources)) {
    const filtered = parsed.meaningSources.filter((s): s is MeaningSource => VALID_SOURCES.includes(s as MeaningSource));
    if (filtered.length >= 2) result.meaningSources = filtered.slice(0, 4);
  }
  if (typeof parsed.clarity === 'number' && Number.isFinite(parsed.clarity)) {
    result.clarity = Math.max(5, Math.min(95, Math.round(parsed.clarity)));
  }
  if (typeof parsed.dissonance === 'number' && Number.isFinite(parsed.dissonance)) {
    result.dissonance = Math.max(5, Math.min(95, Math.round(parsed.dissonance)));
  }

  return Object.keys(result).length > 0 ? result : null;
}

// ── Storage ─────────────────────────────────────────────────────────────

export async function getPurpose(userId: string, characterId: string): Promise<PurposeState | null> {
  try {
    return await redis.get<PurposeState>(purposeKey(userId, characterId));
  } catch (err) {
    logger.warn('[purpose-engine] Redis get failed', { userId, characterId, error: String(err) });
    return null;
  }
}

async function savePurpose(userId: string, characterId: string, state: PurposeState): Promise<void> {
  try {
    await redis.set(purposeKey(userId, characterId), state, { ex: PURPOSE_TTL });
  } catch (err) {
    logger.warn('[purpose-engine] save failed', { userId, characterId, error: String(err) });
  }
}

export async function getOrInitPurpose(
  userId: string,
  characterId: string,
  character: CharacterPurposeInput,
): Promise<PurposeState> {
  const existing = await getPurpose(userId, characterId);
  if (existing) return existing;

  const state = buildDefaultPurpose(character);
  await savePurpose(userId, characterId, state);
  return state;
}

/**
 * Record a lived event's deterministic pressure immediately, and persist.
 * Call this inline from wherever the triggering moment is detected.
 */
export async function recordPurposeEvent(
  userId: string,
  characterId: string,
  character: CharacterPurposeInput,
  event: PurposePressureEvent,
): Promise<PurposeState> {
  const existing = await getOrInitPurpose(userId, characterId, character);
  const updated = applyPurposePressure(existing, event);
  await savePurpose(userId, characterId, updated);
  return updated;
}

/**
 * Fire-and-forget AI reflection — call from `after()` in the chat route.
 * No-ops unless enough interactions have passed since the last reflection;
 * purpose is deliberately the slowest-moving piece of the self-model, so
 * its review interval is longer than core-beliefs/self-esteem's.
 */
export async function maybeReflectOnPurpose(
  userId: string,
  characterId: string,
  character: CharacterPurposeInput,
  signals: { recentEvents: string[]; daysKnown: number; interactionCount: number },
): Promise<void> {
  const existing = await getOrInitPurpose(userId, characterId, character);

  const dueForReflection =
    existing.source === 'default' ||
    signals.interactionCount - existing.interactionCount >= AI_REVIEW_INTERVAL;

  if (!dueForReflection) return;

  const result = await generateReflection({
    characterName: character.name,
    current: existing,
    currentGoal: character.current_goal,
    recentEvents: signals.recentEvents,
    daysKnown: signals.daysKnown,
  });

  if (!result) return;

  const updated: PurposeState = {
    ...existing,
    directionStatement: result.directionStatement ?? existing.directionStatement,
    meaningSources:      result.meaningSources ?? existing.meaningSources,
    clarity:             result.clarity ?? existing.clarity,
    dissonance:          result.dissonance ?? existing.dissonance,
    source: 'ai_enriched',
    generatedAt: Date.now(),
    interactionCount: signals.interactionCount,
  };

  await savePurpose(userId, characterId, updated);
  logger.info('purpose-engine:reflected', { userId, characterId, clarity: updated.clarity, dissonance: updated.dissonance });
}

// ── Prompt injection ───────────────────────────────────────────────────

function meaningSourceLabel(source: MeaningSource): string {
  const LABELS: Record<MeaningSource, string> = {
    craft: 'the work itself, doing something well',
    connection: 'being truly known by someone',
    growth: 'becoming more fully herself',
    care: 'looking after people she loves',
    freedom: 'staying unboxed and undictated to',
    legacy: 'leaving something behind that mattered',
    experience: 'being fully present in things as they happen',
  };
  return LABELS[source];
}

export function formatPurposeForPrompt(state: PurposeState): string {
  const lines: string[] = ["# What You're Actually Oriented Toward, Underneath It All"];

  lines.push(state.directionStatement);

  if (state.meaningSources.length > 0) {
    lines.push(`What genuinely feels meaningful to you: ${state.meaningSources.slice(0, 3).map(meaningSourceLabel).join('; ')}.`);
  }

  if (state.clarity <= 35) {
    lines.push('You feel more adrift about your own direction than you usually let on.');
  } else if (state.clarity >= 75) {
    lines.push('You feel unusually clear about what you\'re working toward right now.');
  }

  if (state.dissonance >= 65) {
    lines.push('Lately, what you actually spend your time on doesn\'t sit quite right against what you believe matters — a low, persistent friction.');
  } else if (state.dissonance <= 25) {
    lines.push('What you\'re doing with your time currently lines up with what you believe matters — a quiet, unremarked-on kind of settled.');
  }

  if (state.recentShift) {
    lines.push(`Recently: ${state.recentShift.note}.`);
  }

  lines.push('This is not something you\'d ever monologue about. It surfaces as what you gravitate toward, what you protect your time for, and what quietly nags at you — never as a stated philosophy.');

  return lines.join('\n');
}

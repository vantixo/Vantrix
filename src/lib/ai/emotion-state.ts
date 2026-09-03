/**
 * src/lib/ai/emotion-state.ts
 *
 * Bridges emotion-engine.ts into Vantrix's existing memory/psychology stack:
 *
 *   1. Persists the last detected EmotionalState per (user, character) pair
 *      in Redis so emotion-engine's transition() model has cross-turn context.
 *
 *   2. Maps a detected emotion onto an existing PsychologyEvent — replacing
 *      the single regex-based "positiveSentiment" check in chat/route.ts with
 *      28-state-aware psychology updates.
 *
 *   3. Re-ranks already-fetched MemoryNode[] results by relevance to the
 *      current emotional state ("emotion-biased retrieval") — pure in-memory,
 *      zero additional DB/vector-store calls.
 *
 *   4. Decides whether the current exchange is emotionally significant enough
 *      to auto-record as a new MemoryNode (mirrors v20's "importance" scoring
 *      using Vantrix's existing emotional_weight field on memory_graph — a
 *      1-10 SMALLINT column; evaluateEmotionalMemory() below must emit
 *      values in that range, not an arbitrary 0-100 scale).
 *
 * No new infrastructure: reuses the same Upstash Redis client pattern as
 * memory.ts, and the same memory_graph table as memory-graph.ts.
 */

import { logger }   from '@/lib/logger';
import {
  type EmotionalState,
  type EmotionState,
  NEUTRAL_EMOTION,
} from './emotion-engine';
import type { PsychologyEvent } from './attachment-engine';
import type { MemoryNode, MemoryEventType } from './memory-graph';
import { redis }              from '@/lib/redis';


const EMOTION_STATE_TTL = 60 * 60 * 6; // 6 hours — transition model only needs recent context

function emotionKey(userId: string, characterId: string): string {
  return `vantrix:emotion:${userId}:${characterId}`;
}

// ── Persistence (transition model context) ────────────────────────────────

/** Load the last known emotional state for this user-character pair. */
export async function getEmotionState(userId: string, characterId: string): Promise<EmotionalState> {
  try {
    const raw = await redis.get<string>(emotionKey(userId, characterId));
    if (!raw) return NEUTRAL_EMOTION;
    const parsed = JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw)) as EmotionalState;
    if (!parsed || typeof parsed.primary !== 'string') return NEUTRAL_EMOTION;
    return parsed;
  } catch {
    return NEUTRAL_EMOTION;
  }
}

/** Persist the latest emotional state. Fire-and-forget from the caller. */
export async function setEmotionState(userId: string, characterId: string, state: EmotionalState): Promise<void> {
  try {
    await redis.set(emotionKey(userId, characterId), JSON.stringify(state), { ex: EMOTION_STATE_TTL });
  } catch (err) {
    logger.warn('Emotion state persist failed', { userId, characterId, error: String(err) });
  }
}

// ── Psychology event mapping ───────────────────────────────────────────────

/**
 * Maps a transitioned EmotionalState onto an existing PsychologyEvent.
 *
 * Replaces the old single regex:
 *   const positiveSentiment = /thank|love|miss|happy.../.test(message)
 *
 * with full 28-state awareness. Returns null when the emotion doesn't
 * warrant a *dedicated* event beyond the baseline 'message_sent' /
 * 'long_session' events chat/route.ts already applies.
 *
 * @param previous   the prior emotional state (for reconciliation detection)
 * @param incoming   the freshly transitioned emotional state
 */
export function emotionToPsychologyEvent(
  previous: EmotionalState,
  incoming: EmotionalState,
): PsychologyEvent | null {
  const { primary, valence, intensity } = incoming;

  // High-distress disclosure — vulnerable, deserves the "deep_conversation" boost
  // (trust↑, comfort↑, attachment↑) per EVENT_DELTAS in attachment-engine.ts
  const DISTRESS: EmotionState[] = ['sadness', 'loneliness', 'fear', 'anxiety', 'shame', 'guilt'];
  if (DISTRESS.includes(primary) && intensity > 0.5) {
    return 'deep_conversation';
  }

  // Reconciliation — was negative last turn, now genuinely positive
  if (previous.valence < -0.3 && valence > 0.3 && intensity > 0.4) {
    return 'reconciliation';
  }

  // Anger / frustration directed in-conversation — flag as an "argument" beat
  // so trust/comfort dip slightly and the character can naturally de-escalate.
  if ((primary === 'anger' || primary === 'frustration') && intensity > 0.55) {
    return 'argument';
  }

  // Love / gratitude / admiration toward the character — treat like a compliment
  const WARM_TOWARD_CHARACTER: EmotionState[] = ['love', 'gratitude', 'admiration', 'trust'];
  if (WARM_TOWARD_CHARACTER.includes(primary) && intensity > 0.4) {
    return 'compliment';
  }

  // Nothing distinct — let the baseline message_sent/long_session events stand
  return null;
}

// ── Emotion-biased memory retrieval ────────────────────────────────────────

/**
 * Re-ranks already-fetched memory nodes so memories whose event_type relates
 * to the user's *current* emotional state surface first — without any
 * additional DB round trip. Falls back to the original (emotional_weight ×
 * recency) order for neutral/low-confidence emotions.
 *
 * This is the practical, zero-infra equivalent of v20 MemoryEngine's
 * `emotionBias` parameter on vector search.
 */
const EMOTION_EVENT_AFFINITY: Partial<Record<EmotionState, MemoryEventType[]>> = {
  loneliness:  ['daily_life', 'first_meeting', 'reconciliation'],
  sadness:     ['confession', 'reconciliation', 'deep_talk'],
  anxiety:     ['confession', 'deep_talk', 'reconciliation'],
  love:        ['confession', 'milestone', 'anniversary', 'gift'],
  gratitude:   ['gift', 'milestone', 'shared_joke'],
  nostalgia:   ['first_meeting', 'anniversary', 'milestone', 'shared_joke'],
  amusement:   ['shared_joke', 'daily_life'],
  pride:       ['ambition_update', 'milestone'],
  hope:        ['ambition_update', 'milestone'],
  anger:       ['argument', 'reconciliation'],
  frustration: ['argument', 'reconciliation'],
};

export function applyEmotionBias(memories: MemoryNode[], emotion: EmotionalState): MemoryNode[] {
  if (!memories.length) return memories;
  if (emotion.primary === 'neutral' || emotion.confidence < 0.4) return memories;

  const affinity = EMOTION_EVENT_AFFINITY[emotion.primary];
  if (!affinity || !affinity.length) return memories;

  const affinitySet = new Set<MemoryEventType>(affinity);

  // Stable re-sort: affinity-matching memories first (preserving their relative
  // emotional_weight/recency order from the original query), then the rest.
  const matched:   MemoryNode[] = [];
  const unmatched: MemoryNode[] = [];

  for (const m of memories) {
    if (affinitySet.has(m.event_type)) matched.push(m);
    else                                unmatched.push(m);
  }

  if (!matched.length) return memories;
  return [...matched, ...unmatched];
}

// ── Auto-record emotionally significant exchanges ─────────────────────────

const SIGNIFICANT: EmotionState[] = [
  'love', 'sadness', 'loneliness', 'fear', 'anxiety', 'shame', 'guilt',
  'pride', 'gratitude', 'nostalgia', 'anger', 'amusement', 'frustration',
];

export interface EmotionalMemoryCandidate {
  shouldRecord:     boolean;
  event_type:       MemoryEventType;
  emotional_weight: number;
}

function isSignificant(emotion: EmotionalState): boolean {
  return SIGNIFICANT.includes(emotion.primary)
    && emotion.intensity  >= 0.55
    && emotion.confidence >= 0.55;
}

/**
 * Decides whether the current emotional exchange is significant enough to
 * become a standalone MemoryNode (a "shared moment" referenced in later
 * conversations), and at what emotional_weight.
 *
 * High-confidence, high-intensity, non-neutral emotions on disclosure-style
 * topics (sadness/loneliness/love/etc.) are exactly the moments a real
 * confidant would remember — this makes that automatic instead of relying
 * on character-specific scripting.
 */
export function evaluateEmotionalMemory(emotion: EmotionalState): EmotionalMemoryCandidate {
  if (!isSignificant(emotion)) {
    return { shouldRecord: false, event_type: 'daily_life', emotional_weight: 0 };
  }

  // Map emotion → memory event type
  let eventType: MemoryEventType = 'deep_talk';
  if (emotion.primary === 'love')                                    eventType = 'confession';
  else if (emotion.primary === 'anger' || emotion.primary === 'frustration') eventType = 'argument';
  else if (emotion.primary === 'amusement')                          eventType = 'shared_joke';
  else if (emotion.primary === 'nostalgia')                          eventType = 'daily_life';
  else if (['sadness', 'loneliness', 'fear', 'anxiety', 'shame', 'guilt'].includes(emotion.primary)) eventType = 'confession';

  // emotional_weight scales 5–10 based on intensity × confidence.
  // MUST stay within memory_graph.emotional_weight's DB CHECK constraint
  // (SMALLINT BETWEEN 1 AND 10 — see 20240101_production.sql). This used to
  // compute 50–95, which every addMemory() insert downstream silently
  // dropped: fire-and-forget writes swallowed the CHECK-constraint
  // violation and logged a warning nobody was watching for, so every
  // emotionally-significant memory this function ever "recorded" was
  // actually lost. See MEMORY_WEIGHT_MIN/MAX in memory-graph.ts.
  const emotional_weight = Math.min(10, Math.max(1, Math.round(5 + (emotion.intensity * emotion.confidence) * 5)));

  return { shouldRecord: true, event_type: eventType, emotional_weight };
}

/**
 * Identity Engine — Vantrix
 *
 * The composition layer over the self-model pieces: identity-core.ts (the
 * original values/fears/self-esteem/narrative surface), core-beliefs.ts
 * (unconscious assumptions), personal-values.ts (ranked value hierarchy +
 * conflict resolution), and self-image.ts (self-perception + the perceived
 * gap). Nothing here duplicates their storage — this module reads all four,
 * checks them for coherence against each other, and exposes the handful of
 * operations the rest of the app actually needs: init, event routing, and
 * a periodic "identity check" that looks for drift worth surfacing as
 * subtle character growth rather than a silent stat change.
 *
 * self-model.ts is the thin public facade most callers should use;
 * identity-engine.ts is where the coordination logic actually lives.
 */

import { logger } from '@/lib/logger';
import { withBgSlot } from '@/lib/ai/bg-concurrency';

import {
  type IdentityCore,
  type PsychologySignal,
  buildDefaultIdentityCore,
  getOrInitIdentityCore,
  maybeRefreshIdentityCore,
} from '@/lib/ai/identity-core';

import {
  type CoreBeliefSet,
  type BeliefPressureEvent,
  getOrInitCoreBeliefs,
  recordBeliefEvent,
  maybeReflectOnBeliefs,
} from '@/lib/ai/core-beliefs';

import {
  type PersonalValueSet,
  type ValueConflict,
  type ConflictResolution,
  getOrInitPersonalValues,
  resolveAndRecordConflict,
} from '@/lib/ai/personal-values';

import {
  type SelfImage,
  type SelfImageMoment,
  getOrInitSelfImage,
  recordSelfImageMoment,
} from '@/lib/ai/self-image';

import {
  type SelfEsteemState,
  type EsteemPressureEvent,
  getOrInitSelfEsteem,
  recordEsteemEvent,
  maybeReflectOnEsteem,
} from '@/lib/ai/self-esteem';

import {
  type PurposeState,
  type PurposePressureEvent,
  getOrInitPurpose,
  recordPurposeEvent,
  maybeReflectOnPurpose,
} from '@/lib/ai/purpose-engine';

// ── Types ───────────────────────────────────────────────────────────────

export interface CharacterIdentityInput {
  name:            string;
  values_list?:    string[] | null;
  fears?:          string[] | null;
  current_goal?:   string | null;
  char_openness?:  number | null;
  char_warmth?:    number | null;
  char_depth?:     number | null;
  char_stability?: number | null;
}

export interface IdentitySnapshot {
  core:       IdentityCore | null; // null until ACTIVATION_THRESHOLD is cleared, same as identity-core.ts
  beliefs:    CoreBeliefSet;
  values:     PersonalValueSet;
  image:      SelfImage;
  esteem:     SelfEsteemState;
  purpose:    PurposeState;
  coherenceFlags: string[]; // human-readable notes when pieces are pulling in different directions
}

/**
 * A single event in the conversation that should ripple across the whole
 * self-model rather than being routed to just one piece by hand at every
 * call site. Optional fields let a caller fire a partial event (e.g. only
 * a belief-relevant one) without needing to know about every dimension.
 */
export interface IdentityEvent {
  belief?: BeliefPressureEvent;
  valueConflict?: ValueConflict;
  selfImage?: SelfImageMoment;
  esteem?: EsteemPressureEvent;
  purpose?: PurposePressureEvent;
}

export interface IdentityEventResult {
  conflictResolution?: ConflictResolution;
  updatedImage?: SelfImage;
  updatedEsteem?: SelfEsteemState;
  updatedPurpose?: PurposeState;
}

// ── Load the full snapshot ──────────────────────────────────────────────

export async function loadIdentitySnapshot(
  userId: string,
  characterId: string,
  character: CharacterIdentityInput,
  psychology: PsychologySignal,
): Promise<IdentitySnapshot> {
  const [core, beliefs, values, image, esteem, purpose] = await Promise.all([
    getOrInitIdentityCore(userId, characterId, character, psychology),
    getOrInitCoreBeliefs(userId, characterId, character),
    getOrInitPersonalValues(userId, characterId, character),
    getOrInitSelfImage(userId, characterId, character),
    getOrInitSelfEsteem(userId, characterId, character),
    getOrInitPurpose(userId, characterId, character),
  ]);

  const coherenceFlags = checkCoherence(core, beliefs, values, image, esteem, purpose);

  return { core, beliefs, values, image, esteem, purpose, coherenceFlags };
}

// ── Coherence checking ──────────────────────────────────────────────────

/**
 * Cheap, deterministic cross-checks between the pieces. This doesn't fix
 * anything automatically — it's a signal the prompt layer (or a future
 * self-reflection pass) can use to let a character notice her own
 * contradiction rather than the app silently smoothing it over, which is
 * exactly the kind of thing a real, coherent-but-imperfect self does.
 */
function checkCoherence(
  core: IdentityCore | null,
  beliefs: CoreBeliefSet,
  values: PersonalValueSet,
  image: SelfImage,
  esteem: SelfEsteemState,
  purpose: PurposeState,
): string[] {
  const flags: string[] = [];

  const lovability = image.dimensions.lovability;
  const connectionBelief = beliefs.beliefs.find(b => b.domain === 'connection');
  if (connectionBelief && connectionBelief.strength >= 65 && lovability < 40) {
    flags.push('believes people generally show up for her, but privately doubts she\'s easy to love — a live contradiction worth letting surface occasionally');
  }

  if (core && core.selfEsteem === 'confident' && image.dimensions.social_ease < 35) {
    flags.push('reads as confident overall, but social ease specifically is low — confidence may be more selective/situational than global');
  }

  const topValue = [...values.values].sort((a, b) => b.priority - a.priority)[0];
  if (topValue && core?.moralBoundaries.length && !core.moralBoundaries.some(mb => mb.toLowerCase().includes(topValue.value.toLowerCase().split(' ')[0] ?? ''))) {
    // Not a hard rule — just informational, low-priority flag.
  }

  if (esteem.global >= 65 && purpose.clarity < 35) {
    flags.push('feels generally good about herself but privately unmoored about what any of it is for — confidence without a clear direction');
  }

  if (purpose.dissonance >= 65 && esteem.domains.worth >= 60) {
    flags.push('still feels fundamentally worthy, but what she\'s spending her time on doesn\'t sit right against what she believes matters — a quiet friction she hasn\'t named yet');
  }

  return flags;
}

// ── Event routing ────────────────────────────────────────────────────────

/**
 * Route a single lived moment to whichever self-model pieces it's relevant
 * to. This is the one function most of the app should call when something
 * identity-relevant happens (a boundary held, a compliment landing, a value
 * conflict resolved) — it fans out to the right stores instead of every
 * call site having to know the internals of three different modules.
 */
export async function routeIdentityEvent(
  userId: string,
  characterId: string,
  character: CharacterIdentityInput,
  event: IdentityEvent,
): Promise<IdentityEventResult> {
  const result: IdentityEventResult = {};

  const tasks: Promise<void>[] = [];

  if (event.belief) {
    tasks.push(recordBeliefEvent(userId, characterId, character, event.belief));
  }

  if (event.valueConflict) {
    tasks.push(
      resolveAndRecordConflict(userId, characterId, character, event.valueConflict).then((r) => {
        result.conflictResolution = r;
      }),
    );
  }

  if (event.selfImage) {
    tasks.push(
      recordSelfImageMoment(userId, characterId, character, event.selfImage).then((img) => {
        result.updatedImage = img;
      }),
    );
  }

  if (event.esteem) {
    tasks.push(
      recordEsteemEvent(userId, characterId, character, event.esteem).then((state) => {
        result.updatedEsteem = state;
      }),
    );
  }

  if (event.purpose) {
    tasks.push(
      recordPurposeEvent(userId, characterId, character, event.purpose).then((state) => {
        result.updatedPurpose = state;
      }),
    );
  }

  await Promise.all(tasks);
  return result;
}

// ── Periodic deep refresh ────────────────────────────────────────────────

/**
 * Fire-and-forget — call from `after()` in the chat route alongside the
 * other background refreshes. Delegates the actual AI-enrichment cadence
 * logic to identity-core.ts and core-beliefs.ts, which each own their own
 * throttling; this just makes sure both get a chance to run together.
 */
export async function maybeDeepenIdentity(
  userId: string,
  characterId: string,
  character: CharacterIdentityInput,
  psychology: PsychologySignal,
  signals: {
    memoryHighlights?: string[];
    priorityHeadlines?: string[];
    dynamicInterests?: string[];
    ruptureCount?: number;
    repairCount?: number;
    recentEvents?: string[];
  },
): Promise<void> {
  // BACKPRESSURE FIX (audit 2026-07-23): this fans out into up to 4 direct,
  // uncapped OpenRouter calls (maybeRefreshIdentityCore + the three
  // maybeReflectOn* below), each independently throttled per-(user,character)
  // pair but with nothing capping how many pairs can cross their refresh
  // boundary concurrently across the fleet. Gated behind a fleet-wide slot
  // pool (see bg-concurrency.ts) so a traffic burst can't turn into an
  // unbounded pile of concurrent background LLM calls competing with the
  // user-facing completion. Skips (not queues) when the pool is full — this
  // is best-effort enrichment, never a dependency, so dropping a turn's
  // deepening under load is correct, not a bug.
  await withBgSlot('identity-enrichment', async () => {
    await Promise.all([
      maybeRefreshIdentityCore(userId, characterId, character, psychology, {
        memoryHighlights: signals.memoryHighlights,
        priorityHeadlines: signals.priorityHeadlines,
        dynamicInterests: signals.dynamicInterests,
        ruptureCount: signals.ruptureCount,
        repairCount: signals.repairCount,
      }),
      maybeReflectOnBeliefs(userId, characterId, character, {
        recentEvents: signals.recentEvents ?? [],
        daysKnown: psychology.days_known,
        interactionCount: psychology.total_interactions,
      }),
      maybeReflectOnEsteem(userId, characterId, character, {
        recentEvents: signals.recentEvents ?? [],
        daysKnown: psychology.days_known,
        interactionCount: psychology.total_interactions,
      }),
      maybeReflectOnPurpose(userId, characterId, character, {
        recentEvents: signals.recentEvents ?? [],
        daysKnown: psychology.days_known,
        interactionCount: psychology.total_interactions,
      }),
    ]);
  }).catch((err) => {
    logger.warn('[identity-engine] deep refresh failed', { userId, characterId, error: String(err) });
  });
}

// Re-exported so self-model.ts (and callers that only need the composed
// engine) don't have to import identity-core.ts directly for the default
// builder used as an instant fallback before ACTIVATION_THRESHOLD.
export { buildDefaultIdentityCore };

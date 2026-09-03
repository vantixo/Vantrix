/**
 * Self-Model — Vantrix
 *
 * Public facade over the whole self-model layer (identity-core.ts,
 * core-beliefs.ts, personal-values.ts, self-image.ts, self-esteem.ts,
 * purpose-engine.ts, identity-engine.ts). Most of the app should only
 * ever need this file: load the model once per turn, format it into the
 * prompt, and route events through it when something identity-relevant
 * happens. Everything else in this directory's self-model files is an
 * implementation detail this module composes.
 *
 * Design mirrors the rest of the AI layer: instant, zero-API defaults on
 * the hot path (buildDefaultSelfModel), background AI enrichment via
 * `after()` (maybeDeepenSelfModel), Redis storage with TTL, nothing here is
 * a system of record — it's all derived from character config + the
 * character's own accumulated history elsewhere in the app.
 */

import { logger } from '@/lib/logger';

import {
  type IdentitySnapshot,
  type IdentityEvent,
  type IdentityEventResult,
  type CharacterIdentityInput,
  loadIdentitySnapshot,
  routeIdentityEvent,
  maybeDeepenIdentity,
  buildDefaultIdentityCore,
} from '@/lib/ai/identity-engine';

import { type PsychologySignal } from '@/lib/ai/identity-core';
import { formatIdentityCoreForPrompt } from '@/lib/ai/identity-core';
import { buildDefaultCoreBeliefs, formatCoreBeliefsForPrompt } from '@/lib/ai/core-beliefs';
import { buildDefaultPersonalValues, formatPersonalValuesForPrompt } from '@/lib/ai/personal-values';
import { buildDefaultSelfImage, formatSelfImageForPrompt } from '@/lib/ai/self-image';
import { buildDefaultSelfEsteem, formatSelfEsteemForPrompt } from '@/lib/ai/self-esteem';
import { buildDefaultPurpose, formatPurposeForPrompt } from '@/lib/ai/purpose-engine';

// ── Public types ────────────────────────────────────────────────────────

export type { CharacterIdentityInput, IdentityEvent, IdentityEventResult, IdentitySnapshot };

export interface SelfModel {
  snapshot: IdentitySnapshot;
  /** Fully assembled, ready-to-inject prompt block for everything in the self-model. */
  promptBlock: string;
}

// ── Load ────────────────────────────────────────────────────────────────

/**
 * Load the complete self-model for a (user, character) pair. Safe to call
 * on every chat turn — each underlying piece is Redis-cached and only the
 * very first call per pair does real setup work; everything else is a
 * cache hit plus, occasionally, a throttled background refresh handled
 * separately by maybeDeepenSelfModel.
 */
export async function loadSelfModel(
  userId: string,
  characterId: string,
  character: CharacterIdentityInput,
  psychology: PsychologySignal,
): Promise<SelfModel> {
  try {
    const snapshot = await loadIdentitySnapshot(userId, characterId, character, psychology);
    return { snapshot, promptBlock: formatSelfModelForPrompt(snapshot) };
  } catch (err) {
    logger.warn('[self-model] load failed, falling back to instant defaults', { userId, characterId, error: String(err) });
    return buildDefaultSelfModel(character, psychology);
  }
}

/**
 * Fully synchronous, zero-API fallback — used if Redis is unavailable or
 * before any history exists. Guarantees the prompt layer always has
 * *something* to work with, same philosophy as identity-core.ts's
 * buildDefaultIdentityCore.
 */
export function buildDefaultSelfModel(
  character: CharacterIdentityInput,
  psychology: PsychologySignal,
): SelfModel {
  const snapshot: IdentitySnapshot = {
    core: psychology.total_interactions >= 15 ? buildDefaultIdentityCore(character, psychology) : null,
    beliefs: buildDefaultCoreBeliefs(character),
    values: buildDefaultPersonalValues(character),
    image: buildDefaultSelfImage(character),
    esteem: buildDefaultSelfEsteem(character),
    purpose: buildDefaultPurpose(character),
    coherenceFlags: [],
  };

  return { snapshot, promptBlock: formatSelfModelForPrompt(snapshot) };
}

// ── Format ──────────────────────────────────────────────────────────────

/**
 * Assemble every piece of the self-model into one prompt block, in the
 * order a person's own self tends to surface: values first (what she'd
 * say she stands for), then the deeper identity-core layer (fears,
 * ambition, esteem, contradictions), then unconscious beliefs, then
 * self-image last, since it's the most reactive/moment-to-moment layer.
 * Coherence flags are appended quietly at the end as texture, not
 * instruction — a real self doesn't resolve its own contradictions on
 * command.
 */
export function formatSelfModelForPrompt(snapshot: IdentitySnapshot): string {
  const sections: string[] = [];

  const valuesBlock = formatPersonalValuesForPrompt(snapshot.values);
  if (valuesBlock) sections.push(valuesBlock);

  if (snapshot.core) {
    sections.push(formatIdentityCoreForPrompt(snapshot.core));
  }

  const beliefsBlock = formatCoreBeliefsForPrompt(snapshot.beliefs);
  if (beliefsBlock) sections.push(beliefsBlock);

  const imageBlock = formatSelfImageForPrompt(snapshot.image);
  if (imageBlock) sections.push(imageBlock);

  const esteemBlock = formatSelfEsteemForPrompt(snapshot.esteem);
  if (esteemBlock) sections.push(esteemBlock);

  const purposeBlock = formatPurposeForPrompt(snapshot.purpose);
  if (purposeBlock) sections.push(purposeBlock);

  if (snapshot.coherenceFlags.length) {
    sections.push(
      ['# Things About Yourself That Don\'t Fully Add Up',
        ...snapshot.coherenceFlags.map(f => `- ${f}`),
        'You don\'t need to resolve these. Real people carry contradictions without narrating them — let this one surface, at most, as a flicker of self-awareness, never an explanation.',
      ].join('\n'),
    );
  }

  return sections.join('\n\n');
}

// ── Events ──────────────────────────────────────────────────────────────

/**
 * Route a lived moment (boundary held/violated, compliment landing, value
 * conflict resolved, etc) through the whole self-model. Thin pass-through
 * to identity-engine.ts, exposed here so callers never need to import that
 * module directly.
 */
export async function recordSelfModelEvent(
  userId: string,
  characterId: string,
  character: CharacterIdentityInput,
  event: IdentityEvent,
): Promise<IdentityEventResult> {
  return routeIdentityEvent(userId, characterId, character, event);
}

// ── Background deepening ──────────────────────────────────────────────

/**
 * Fire-and-forget — call once from `after()` in the chat route. Internally
 * throttled per-piece, so this is cheap to call on every turn even though
 * it only does real work occasionally.
 */
export async function maybeDeepenSelfModel(
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
  } = {},
): Promise<void> {
  await maybeDeepenIdentity(userId, characterId, character, psychology, signals);
}

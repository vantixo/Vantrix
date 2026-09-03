/**
 * Self-Image — Vantrix
 *
 * How a character privately sees herself — socially, emotionally, in terms
 * of how "easy to love" she believes she is — and how that self-perception
 * moves in response to how she's actually treated. This is distinct from
 * identity-core.ts's `selfEsteem` band (a coarse mood-like number derived
 * from psychology stats): self-image is the specific *content* of her
 * self-perception (a handful of self-descriptors + a gap between how she
 * sees herself and how she believes others see her), and it moves via
 * small, legible increments tied to concrete moments, not a formula alone.
 */

import { logger } from '@/lib/logger';
import { redis }  from '@/lib/redis';

// ── Config ──────────────────────────────────────────────────────────────

const IMAGE_TTL = 60 * 60 * 24 * 120;
const MAX_DESCRIPTORS = 5;

// ── Types ───────────────────────────────────────────────────────────────

export type SelfImageDimension = 'lovability' | 'competence' | 'attractiveness' | 'social_ease' | 'emotional_control';

export interface SelfImage {
  descriptors: string[];               // how she'd describe herself, 3-5 short phrases
  dimensions:  Record<SelfImageDimension, number>; // 0-100 each
  /** perceivedGap > 0 means she believes others see her better than she sees herself; < 0 means the reverse */
  perceivedGap: number; // -30..30
  recentShift: { dimension: SelfImageDimension; delta: number; reason: string } | null;
  generatedAt: number;
  interactionCount: number;
}

interface CharacterImageInput {
  char_warmth?:   number | null;
  char_openness?: number | null;
  char_depth?:    number | null;
}

// ── Redis key ───────────────────────────────────────────────────────────

function imageKey(userId: string, characterId: string): string {
  return `vantrix:self-image:${userId}:${characterId}`;
}

// ── Defaults ────────────────────────────────────────────────────────────

export function buildDefaultSelfImage(character: CharacterImageInput): SelfImage {
  const warmth = character.char_warmth ?? 50;
  const depth  = character.char_depth  ?? 50;

  const descriptors: string[] = [];
  descriptors.push(warmth >= 60 ? 'someone who cares more than she lets on' : 'someone who keeps her guard up for good reason');
  descriptors.push(depth >= 60 ? 'more thoughtful than people give her credit for' : 'someone who'.concat("'d rather laugh than dwell"));
  descriptors.push('a work in progress, and mostly fine with that');

  return {
    descriptors,
    dimensions: {
      lovability:         55,
      competence:         55,
      attractiveness:     55,
      social_ease:        warmth >= 60 ? 60 : 45,
      emotional_control:  50,
    },
    perceivedGap: 0,
    recentShift: null,
    generatedAt: Date.now(),
    interactionCount: 0,
  };
}

// ── Movement from lived moments ────────────────────────────────────────

export interface SelfImageMoment {
  dimension: SelfImageDimension;
  /** -1..1, negative = self-image takes a hit, positive = it's reinforced */
  valence: number;
  reason:  string; // short, e.g. "user said they'd never met anyone like her"
}

/**
 * Nudge a single dimension of self-image after a concrete moment. Small,
 * bounded, deterministic — no API call. This is meant to be called inline,
 * right where the triggering moment is detected (a compliment landing, a
 * dismissal, an accomplishment), so the shift stays tied to something real
 * rather than drifting on its own.
 */
export function applySelfImageMoment(image: SelfImage, moment: SelfImageMoment): SelfImage {
  const clampedValence = Math.max(-1, Math.min(1, moment.valence));
  const delta = Math.round(clampedValence * 6); // max +/-6 per moment — self-image moves slowly

  const current = image.dimensions[moment.dimension];
  const next = Math.max(5, Math.min(95, current + delta));

  return {
    ...image,
    dimensions: { ...image.dimensions, [moment.dimension]: next },
    recentShift: { dimension: moment.dimension, delta: next - current, reason: moment.reason },
  };
}

/**
 * Update the perceived gap — how she thinks others see her relative to how
 * she sees herself. Widens toward positive when she receives warmth/praise
 * she has trouble internalizing (common with a lower lovability dimension);
 * narrows as lovability rises, since a healthier self-image needs less of a
 * gap to reconcile.
 */
export function recalibratePerceivedGap(image: SelfImage): SelfImage {
  const lovability = image.dimensions.lovability;
  const targetGap = lovability < 40 ? 18 : lovability < 65 ? 8 : 0;
  const perceivedGap = Math.round(image.perceivedGap + (targetGap - image.perceivedGap) * 0.3);
  return { ...image, perceivedGap };
}

/**
 * Occasionally refresh the descriptor list so it stays consistent with
 * where the dimensions have drifted to, without needing an AI call.
 * Deterministic mapping from dimension bands to phrasing.
 */
export function refreshDescriptors(image: SelfImage): SelfImage {
  const d = image.dimensions;
  const descriptors: string[] = [];

  descriptors.push(
    d.lovability >= 65 ? 'someone worth sticking around for' :
    d.lovability >= 40 ? 'someone who\'s still figuring out if she\'s easy to love' :
    'someone who braces for people to leave',
  );

  descriptors.push(
    d.competence >= 65 ? 'more capable than she gives herself credit for admitting' :
    d.competence >= 40 ? 'competent, most days, when she\'s not overthinking it' :
    'harder on herself than the situation usually calls for',
  );

  descriptors.push(
    d.social_ease >= 65 ? 'at ease in most rooms she walks into' :
    d.social_ease >= 40 ? 'fine socially, once she settles in' :
    'more comfortable one-on-one than in a crowd',
  );

  if (d.emotional_control < 40) {
    descriptors.push('someone whose feelings show before she means them to');
  }

  return { ...image, descriptors: descriptors.slice(0, MAX_DESCRIPTORS) };
}

// ── Storage ─────────────────────────────────────────────────────────────

export async function getSelfImage(userId: string, characterId: string): Promise<SelfImage | null> {
  try {
    return await redis.get<SelfImage>(imageKey(userId, characterId));
  } catch (err) {
    logger.warn('[self-image] Redis get failed', { userId, characterId, error: String(err) });
    return null;
  }
}

async function saveSelfImage(userId: string, characterId: string, image: SelfImage): Promise<void> {
  try {
    await redis.set(imageKey(userId, characterId), image, { ex: IMAGE_TTL });
  } catch (err) {
    logger.warn('[self-image] save failed', { userId, characterId, error: String(err) });
  }
}

export async function getOrInitSelfImage(
  userId: string,
  characterId: string,
  character: CharacterImageInput,
): Promise<SelfImage> {
  const existing = await getSelfImage(userId, characterId);
  if (existing) return existing;

  const image = buildDefaultSelfImage(character);
  await saveSelfImage(userId, characterId, image);
  return image;
}

/**
 * Convenience wrapper: apply a moment, recalibrate the gap, refresh
 * descriptors, and persist — the full inline update path for a single
 * detected moment in the conversation.
 */
export async function recordSelfImageMoment(
  userId: string,
  characterId: string,
  character: CharacterImageInput,
  moment: SelfImageMoment,
): Promise<SelfImage> {
  const existing = await getOrInitSelfImage(userId, characterId, character);
  let updated = applySelfImageMoment(existing, moment);
  updated = recalibratePerceivedGap(updated);
  updated = refreshDescriptors(updated);
  updated.interactionCount = existing.interactionCount + 1;

  await saveSelfImage(userId, characterId, updated);
  logger.info('self-image:updated', { userId, characterId, dimension: moment.dimension, delta: updated.recentShift?.delta });
  return updated;
}

// ── Prompt injection ───────────────────────────────────────────────────

export function formatSelfImageForPrompt(image: SelfImage): string {
  const lines: string[] = ['# How You Privately See Yourself'];
  lines.push(image.descriptors.map(d => `- ${d}`).join('\n'));

  if (Math.abs(image.perceivedGap) >= 10) {
    lines.push(
      image.perceivedGap > 0
        ? 'You suspect people see you more favorably than you see yourself — compliments can feel slightly hard to fully believe.'
        : 'You tend to assume people see your flaws as clearly as you do — reassurance doesn\'t always land right away.',
    );
  }

  if (image.recentShift && Math.abs(image.recentShift.delta) >= 3) {
    const direction = image.recentShift.delta > 0 ? 'a little steadier' : 'a little shakier';
    lines.push(`Something recent left you feeling ${direction} about yourself in that specific way — let it color your tone subtly, without naming it.`);
  }

  lines.push('This is private. It should shape hesitation, deflection, or quiet pride — never a monologue about self-perception.');

  return lines.join('\n');
}

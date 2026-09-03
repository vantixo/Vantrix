/**
 * Character Model — Vantrix
 *
 * Theory of mind needs two sides: a model of the user (user-model.ts) and a
 * model of the character's own mental state as a distinct, trackable thing
 * — what *she* currently knows, what she's said versus what she actually
 * believes, and what she privately intends. Without this, "what others
 * believe" in theory-of-mind.ts has nothing concrete to compare the user's
 * model against, and deception/misunderstanding detection has no source of
 * truth for what the character herself actually knows.
 *
 * This is deliberately narrow: it is NOT self-model.ts (identity, values,
 * self-image — who she is) and NOT emotion-state.ts (how she feels). It's
 * the epistemic layer — what's in her head, factually, right now — that
 * theory-of-mind.ts reasons about relative to what she thinks the user
 * knows.
 */

import { logger } from '@/lib/logger';
import { redis }  from '@/lib/redis';

// ── Config ──────────────────────────────────────────────────────────────

const MODEL_TTL = 60 * 60 * 24 * 60; // 60 days
const MAX_KNOWN_FACTS = 40;
const MAX_STATED_CLAIMS = 20;

// ── Types ───────────────────────────────────────────────────────────────

export interface KnownFact {
  id:          string;
  content:     string;     // what she knows, from her POV — "user's sister is named Maya"
  learnedAt:   number;
  /** Did she learn this directly from the user, infer it, or was it something she told the user (so it's self-generated)? */
  learnedVia:  'told_by_user' | 'inferred' | 'self_disclosed' | 'observed';
  certainty:   number;      // 0-100 — she can "know" something tentatively
}

/**
 * Something she has said to the user, tracked separately from what she
 * actually believes/knows — the gap between the two is exactly what
 * theory-of-mind.ts and social-model.ts need for deception/inconsistency
 * detection. Most StatedClaims match her real belief; a minority (a white
 * lie, a deflection, a secret she's protecting) deliberately don't.
 */
export interface StatedClaim {
  id:          string;
  content:     string;      // what she told the user
  statedAt:    number;
  /** true if this claim matches what she actually believes/knows; false = she said something she doesn't fully believe */
  sincere:     boolean;
  /** only set when sincere === false — why she said it anyway */
  reason?:     'protecting_user' | 'protecting_self' | 'social_convention' | 'withholding_secret' | 'playful';
}

export interface Intention {
  id:          string;
  content:     string;      // "wants to bring up the trip without seeming pushy"
  createdAt:   number;
  active:      boolean;
}

export interface CharacterModel {
  knownFacts:   KnownFact[];
  statedClaims: StatedClaim[];
  intentions:   Intention[];
  updatedAt:    number;
}

// ── Redis key ───────────────────────────────────────────────────────────

function modelKey(userId: string, characterId: string): string {
  return `vantrix:character-model:${userId}:${characterId}`;
}

function slugId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function emptyCharacterModel(): CharacterModel {
  return { knownFacts: [], statedClaims: [], intentions: [], updatedAt: Date.now() };
}

// ── Storage ─────────────────────────────────────────────────────────────

export async function getCharacterModel(userId: string, characterId: string): Promise<CharacterModel> {
  try {
    const model = await redis.get<CharacterModel>(modelKey(userId, characterId));
    return model ?? emptyCharacterModel();
  } catch (err) {
    logger.warn('[character-model] Redis get failed', { userId, characterId, error: String(err) });
    return emptyCharacterModel();
  }
}

async function saveCharacterModel(userId: string, characterId: string, model: CharacterModel): Promise<void> {
  try {
    await redis.set(modelKey(userId, characterId), model, { ex: MODEL_TTL });
  } catch (err) {
    logger.warn('[character-model] save failed', { userId, characterId, error: String(err) });
  }
}

// ── Mutations ───────────────────────────────────────────────────────────

export async function recordKnownFact(
  userId: string,
  characterId: string,
  fact: Omit<KnownFact, 'id' | 'learnedAt'>,
): Promise<CharacterModel> {
  const model = await getCharacterModel(userId, characterId);

  const known: KnownFact = { ...fact, id: slugId('fact'), learnedAt: Date.now() };
  let knownFacts = [...model.knownFacts, known];

  if (knownFacts.length > MAX_KNOWN_FACTS) {
    // Drop the oldest, lowest-certainty fact first — recent and confident
    // knowledge is what should stay accessible.
    knownFacts = [...knownFacts].sort((a, b) => (a.certainty - b.certainty) || (a.learnedAt - b.learnedAt));
    knownFacts = knownFacts.slice(1);
  }

  const updated: CharacterModel = { ...model, knownFacts, updatedAt: Date.now() };
  await saveCharacterModel(userId, characterId, updated);
  return updated;
}

/**
 * Record something the character said to the user. If `sincere` is false,
 * this is where a deliberate gap between her real knowledge and her stated
 * word gets tracked — the raw material theory-of-mind.ts uses to reason
 * about deception and social-model.ts uses to reason about trust risk.
 */
export async function recordStatedClaim(
  userId: string,
  characterId: string,
  claim: Omit<StatedClaim, 'id' | 'statedAt'>,
): Promise<CharacterModel> {
  const model = await getCharacterModel(userId, characterId);

  const stated: StatedClaim = { ...claim, id: slugId('claim'), statedAt: Date.now() };
  let statedClaims = [...model.statedClaims, stated];

  if (statedClaims.length > MAX_STATED_CLAIMS) {
    statedClaims = statedClaims.slice(statedClaims.length - MAX_STATED_CLAIMS);
  }

  const updated: CharacterModel = { ...model, statedClaims, updatedAt: Date.now() };
  await saveCharacterModel(userId, characterId, updated);
  return updated;
}

export async function setIntention(
  userId: string,
  characterId: string,
  content: string,
): Promise<CharacterModel> {
  const model = await getCharacterModel(userId, characterId);
  const intention: Intention = { id: slugId('intent'), content, createdAt: Date.now(), active: true };
  const intentions = [...model.intentions.filter(i => i.active), intention].slice(-8);

  const updated: CharacterModel = { ...model, intentions, updatedAt: Date.now() };
  await saveCharacterModel(userId, characterId, updated);
  return updated;
}

export async function resolveIntention(userId: string, characterId: string, intentionId: string): Promise<CharacterModel> {
  const model = await getCharacterModel(userId, characterId);
  const intentions = model.intentions.map(i => (i.id === intentionId ? { ...i, active: false } : i));
  const updated: CharacterModel = { ...model, intentions, updatedAt: Date.now() };
  await saveCharacterModel(userId, characterId, updated);
  return updated;
}

// ── Queries used by theory-of-mind.ts / social-model.ts ────────────────

/** Every insincere claim still "on the record" — she hasn't corrected or been caught. */
export function activeInsincereClaims(model: CharacterModel): StatedClaim[] {
  return model.statedClaims.filter(c => !c.sincere);
}

export function activeIntentions(model: CharacterModel): Intention[] {
  return model.intentions.filter(i => i.active);
}

// ── Prompt injection ───────────────────────────────────────────────────

export function formatCharacterModelForPrompt(model: CharacterModel): string {
  const lines: string[] = [];
  const insincere = activeInsincereClaims(model);
  const intentions = activeIntentions(model);

  if (insincere.length) {
    lines.push('# Things You Said That Weren\'t Fully True');
    for (const c of insincere) {
      lines.push(`- You told them: "${c.content}" — but that wasn't entirely sincere. Stay consistent with it unless the conversation naturally gives you a reason to revisit it.`);
    }
  }

  if (intentions.length) {
    lines.push('# What You\'re Quietly Trying To Do Right Now');
    for (const i of intentions) {
      lines.push(`- ${i.content}`);
    }
  }

  if (!lines.length) return '';
  lines.push('Never narrate any of this directly — it should only shape word choice, timing, and what you steer around.');
  return lines.join('\n');
}

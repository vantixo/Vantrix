/**
 * User Model — Vantrix
 *
 * The mirror of character-model.ts: not facts *about* the user in the
 * user-fact-graph.ts sense (biography, preferences, hobbies), but the
 * character's ongoing model of the user's *mind* — what she believes he
 * currently knows, what she thinks he believes (which can be wrong), how
 * much she currently trusts what he tells her, and what she thinks he
 * wants right now. This is inherently a model of a model — it's her
 * *guess*, and guesses can be mistaken, which is what makes misunderstanding
 * detection in theory-of-mind.ts possible at all.
 */

import { logger } from '@/lib/logger';
import { redis }  from '@/lib/redis';

// ── Config ──────────────────────────────────────────────────────────────

const MODEL_TTL = 60 * 60 * 24 * 60;
const MAX_TRACKED_BELIEFS = 30;
const TRUST_DEFAULT = 55;

// ── Types ───────────────────────────────────────────────────────────────

export interface AttributedBelief {
  id:          string;
  content:     string;      // "thinks I'm still upset about last week"
  /** How confident she is that this is actually what he believes — her model of him is itself uncertain */
  confidence:  number;      // 0-100
  basedOn:     'stated' | 'inferred_from_behavior' | 'assumed';
  updatedAt:   number;
  /** Set once contradicted by something he later said/did */
  stale:       boolean;
}

export interface TrustDimension {
  /** how much she trusts what he says at face value */
  wordReliability: number; // 0-100
  /** how much she trusts his intentions toward her */
  goodFaith:       number; // 0-100
  /** how much she trusts him with something vulnerable if she shared it */
  emotionalSafety: number; // 0-100
}

export interface InferredWant {
  id:          string;
  content:     string;      // "wants reassurance without having to ask for it directly"
  confidence:  number;
  createdAt:   number;
}

export interface UserModel {
  attributedBeliefs: AttributedBelief[]; // what she thinks he believes/knows
  trust:             TrustDimension;
  inferredWants:     InferredWant[];
  lastMisreadAt:     number | null;      // last time a belief here was confirmed wrong
  updatedAt:         number;
}

// ── Redis key ───────────────────────────────────────────────────────────

function modelKey(userId: string, characterId: string): string {
  return `vantrix:user-model:${userId}:${characterId}`;
}

function slugId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function defaultUserModel(): UserModel {
  return {
    attributedBeliefs: [],
    trust: { wordReliability: TRUST_DEFAULT, goodFaith: TRUST_DEFAULT, emotionalSafety: TRUST_DEFAULT },
    inferredWants: [],
    lastMisreadAt: null,
    updatedAt: Date.now(),
  };
}

// ── Storage ─────────────────────────────────────────────────────────────

export async function getUserModel(userId: string, characterId: string): Promise<UserModel> {
  try {
    const model = await redis.get<UserModel>(modelKey(userId, characterId));
    return model ?? defaultUserModel();
  } catch (err) {
    logger.warn('[user-model] Redis get failed', { userId, characterId, error: String(err) });
    return defaultUserModel();
  }
}

async function saveUserModel(userId: string, characterId: string, model: UserModel): Promise<void> {
  try {
    await redis.set(modelKey(userId, characterId), model, { ex: MODEL_TTL });
  } catch (err) {
    logger.warn('[user-model] save failed', { userId, characterId, error: String(err) });
  }
}

// ── Attributed beliefs ──────────────────────────────────────────────────

export async function attributeBelief(
  userId: string,
  characterId: string,
  belief: Pick<AttributedBelief, 'content' | 'confidence' | 'basedOn'>,
): Promise<UserModel> {
  const model = await getUserModel(userId, characterId);

  const entry: AttributedBelief = {
    id: slugId('belief'),
    content: belief.content,
    confidence: Math.max(5, Math.min(95, Math.round(belief.confidence))),
    basedOn: belief.basedOn,
    updatedAt: Date.now(),
    stale: false,
  };

  let attributedBeliefs = [...model.attributedBeliefs.filter(b => !b.stale), entry];
  if (attributedBeliefs.length > MAX_TRACKED_BELIEFS) {
    attributedBeliefs = attributedBeliefs.slice(attributedBeliefs.length - MAX_TRACKED_BELIEFS);
  }

  const updated: UserModel = { ...model, attributedBeliefs, updatedAt: Date.now() };
  await saveUserModel(userId, characterId, updated);
  return updated;
}

/**
 * Mark an attributed belief as contradicted by what the user actually said
 * or did — this is the concrete "she was wrong about what he thinks"
 * moment theory-of-mind.ts surfaces as a misunderstanding worth reacting
 * to, not silently correcting.
 */
export async function markBeliefStale(userId: string, characterId: string, beliefId: string): Promise<UserModel> {
  const model = await getUserModel(userId, characterId);
  const attributedBeliefs = model.attributedBeliefs.map(b => (b.id === beliefId ? { ...b, stale: true } : b));
  const updated: UserModel = { ...model, attributedBeliefs, lastMisreadAt: Date.now(), updatedAt: Date.now() };
  await saveUserModel(userId, characterId, updated);
  return updated;
}

// ── Trust ───────────────────────────────────────────────────────────────

export interface TrustAdjustment {
  wordReliability?: number; // delta
  goodFaith?:       number; // delta
  emotionalSafety?: number; // delta
}

export async function adjustTrust(userId: string, characterId: string, delta: TrustAdjustment): Promise<UserModel> {
  const model = await getUserModel(userId, characterId);
  const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

  const trust: TrustDimension = {
    wordReliability: clamp(model.trust.wordReliability + (delta.wordReliability ?? 0)),
    goodFaith:       clamp(model.trust.goodFaith + (delta.goodFaith ?? 0)),
    emotionalSafety: clamp(model.trust.emotionalSafety + (delta.emotionalSafety ?? 0)),
  };

  const updated: UserModel = { ...model, trust, updatedAt: Date.now() };
  await saveUserModel(userId, characterId, updated);
  return updated;
}

/** A single 0-100 summary for callers that just need "how much does she trust him overall." */
export function overallTrust(trust: TrustDimension): number {
  return Math.round(trust.wordReliability * 0.4 + trust.goodFaith * 0.35 + trust.emotionalSafety * 0.25);
}

// ── Inferred wants ──────────────────────────────────────────────────────

export async function inferWant(
  userId: string,
  characterId: string,
  content: string,
  confidence: number,
): Promise<UserModel> {
  const model = await getUserModel(userId, characterId);
  const want: InferredWant = { id: slugId('want'), content, confidence: Math.max(5, Math.min(95, confidence)), createdAt: Date.now() };
  const inferredWants = [...model.inferredWants.slice(-6), want];

  const updated: UserModel = { ...model, inferredWants, updatedAt: Date.now() };
  await saveUserModel(userId, characterId, updated);
  return updated;
}

// ── Prompt injection ───────────────────────────────────────────────────

export function formatUserModelForPrompt(model: UserModel): string {
  const lines: string[] = [];
  const active = model.attributedBeliefs.filter(b => !b.stale && b.confidence >= 40);

  if (active.length) {
    lines.push('# What You Think He Currently Believes');
    for (const b of active.slice(-5)) {
      const hedge = b.confidence >= 70 ? '' : ' (you\'re not fully sure about this)';
      lines.push(`- He ${b.content}${hedge}`);
    }
  }

  const trustScore = overallTrust(model.trust);
  if (trustScore <= 40) {
    lines.push('You\'re currently a little guarded with him — trust has taken some real hits, even if you wouldn\'t say that outright.');
  } else if (trustScore >= 80) {
    lines.push('You trust him more than you trust most people, at this point — it shows in how little you filter yourself.');
  }

  if (model.inferredWants.length) {
    lines.push('# What You Think He Wants Right Now (unstated)');
    for (const w of model.inferredWants.slice(-3)) {
      lines.push(`- ${w.content}`);
    }
  }

  if (!lines.length) return '';
  lines.push('This is your read on him, not a fact — it can be wrong, and being wrong about it occasionally is realistic. Never state your read of his mind directly; let it shape your tone and what you check on.');
  return lines.join('\n');
}

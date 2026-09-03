/**
 * Social Model — Vantrix
 *
 * user-model.ts and character-model.ts each track one mind. Social
 * dynamics live in the space *between* them and don't belong to either
 * side alone: what's common ground (both parties know it, and both know
 * the other knows it) versus asymmetric knowledge, how comfortable the
 * conversation currently feels, and how much social risk a given move
 * (a joke, a vulnerable admission, calling something out) would carry
 * right now given the current trust/comfort state.
 *
 * theory-of-mind.ts is the top-level orchestrator that composes this with
 * user-model.ts and character-model.ts; social-model.ts owns the
 * relational math those two don't individually cover.
 */

import { logger } from '@/lib/logger';
import { redis }  from '@/lib/redis';

import { type TrustDimension, overallTrust } from '@/lib/ai/user-model';

// ── Config ──────────────────────────────────────────────────────────────

const MODEL_TTL = 60 * 60 * 24 * 60;
const MAX_COMMON_GROUND = 30;

// ── Types ───────────────────────────────────────────────────────────────

export interface CommonGroundItem {
  id:        string;
  content:   string;   // "the inside joke about the terrible first date story"
  strength:  number;   // 0-100 — how load-bearing this shared reference is (a single mention vs. a recurring callback)
  lastUsed:  number;
}

export type SocialTemperature = 'tense' | 'cool' | 'neutral' | 'warm' | 'close';

export interface SocialModel {
  commonGround:      CommonGroundItem[];
  temperature:        SocialTemperature;
  /** 0-100 — how much conversational "slack" currently exists for teasing, bluntness, or a risky topic without it landing badly */
  socialSlack:        number;
  /** running count of moments that visibly narrowed the gap between them (an inside joke landing, a shared vulnerable moment) vs widened it (an awkward silence, a joke that fell flat) */
  closenessDelta7d:   number;
  updatedAt:           number;
}

interface CharacterSocialInput {
  char_warmth?: number | null;
}

// ── Redis key ───────────────────────────────────────────────────────────

function modelKey(userId: string, characterId: string): string {
  return `vantrix:social-model:${userId}:${characterId}`;
}

function slugId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function buildDefaultSocialModel(character: CharacterSocialInput): SocialModel {
  const warmth = character.char_warmth ?? 50;
  return {
    commonGround: [],
    temperature: warmth >= 60 ? 'warm' : 'neutral',
    socialSlack: 40,
    closenessDelta7d: 0,
    updatedAt: Date.now(),
  };
}

// ── Storage ─────────────────────────────────────────────────────────────

export async function getSocialModel(userId: string, characterId: string, character: CharacterSocialInput): Promise<SocialModel> {
  try {
    const model = await redis.get<SocialModel>(modelKey(userId, characterId));
    return model ?? buildDefaultSocialModel(character);
  } catch (err) {
    logger.warn('[social-model] Redis get failed', { userId, characterId, error: String(err) });
    return buildDefaultSocialModel(character);
  }
}

async function saveSocialModel(userId: string, characterId: string, model: SocialModel): Promise<void> {
  try {
    await redis.set(modelKey(userId, characterId), model, { ex: MODEL_TTL });
  } catch (err) {
    logger.warn('[social-model] save failed', { userId, characterId, error: String(err) });
  }
}

// ── Common ground ───────────────────────────────────────────────────────

/**
 * Record a piece of shared context both parties now hold — the raw
 * material for callbacks and inside jokes. `strength` should start low for
 * a one-off mention and only climb via `reinforceCommonGround` when it
 * actually gets referenced again later, which is what makes a callback
 * feel earned rather than the system inventing shared history.
 */
export async function addCommonGround(
  userId: string,
  characterId: string,
  character: CharacterSocialInput,
  content: string,
  initialStrength = 25,
): Promise<SocialModel> {
  const model = await getSocialModel(userId, characterId, character);
  const item: CommonGroundItem = { id: slugId('cg'), content, strength: initialStrength, lastUsed: Date.now() };

  let commonGround = [...model.commonGround, item];
  if (commonGround.length > MAX_COMMON_GROUND) {
    commonGround = [...commonGround].sort((a, b) => a.strength - b.strength || a.lastUsed - b.lastUsed).slice(1);
  }

  const updated: SocialModel = { ...model, commonGround, updatedAt: Date.now() };
  await saveSocialModel(userId, characterId, updated);
  return updated;
}

export async function reinforceCommonGround(userId: string, characterId: string, character: CharacterSocialInput, itemId: string): Promise<SocialModel> {
  const model = await getSocialModel(userId, characterId, character);
  const commonGround = model.commonGround.map(cg =>
    cg.id === itemId ? { ...cg, strength: Math.min(100, cg.strength + 15), lastUsed: Date.now() } : cg,
  );
  const updated: SocialModel = { ...model, commonGround, updatedAt: Date.now() };
  await saveSocialModel(userId, characterId, updated);
  return updated;
}

// ── Temperature & slack ─────────────────────────────────────────────────

export interface SocialMoment {
  kind: 'joke_landed' | 'joke_flopped' | 'vulnerable_moment_shared' | 'awkward_silence' | 'conflict' | 'reconciliation';
}

const TEMPERATURE_ORDER: SocialTemperature[] = ['tense', 'cool', 'neutral', 'warm', 'close'];

function shiftTemperature(current: SocialTemperature, steps: number): SocialTemperature {
  const idx = TEMPERATURE_ORDER.indexOf(current);
  const next = Math.max(0, Math.min(TEMPERATURE_ORDER.length - 1, idx + steps));
  return TEMPERATURE_ORDER[next]!;
}

const MOMENT_EFFECTS: Record<SocialMoment['kind'], { temp: number; slack: number; closeness: number }> = {
  joke_landed:              { temp: 0,  slack: +6, closeness: +1 },
  joke_flopped:             { temp: 0,  slack: -8, closeness: 0 },
  vulnerable_moment_shared: { temp: +1, slack: +4, closeness: +2 },
  awkward_silence:          { temp: -1, slack: -5, closeness: -1 },
  conflict:                 { temp: -2, slack: -15, closeness: -2 },
  reconciliation:           { temp: +1, slack: +10, closeness: +2 },
};

export async function recordSocialMoment(
  userId: string,
  characterId: string,
  character: CharacterSocialInput,
  moment: SocialMoment,
): Promise<SocialModel> {
  const model = await getSocialModel(userId, characterId, character);
  const effect = MOMENT_EFFECTS[moment.kind];

  const updated: SocialModel = {
    ...model,
    temperature: shiftTemperature(model.temperature, effect.temp),
    socialSlack: Math.max(0, Math.min(100, model.socialSlack + effect.slack)),
    closenessDelta7d: model.closenessDelta7d + effect.closeness,
    updatedAt: Date.now(),
  };

  await saveSocialModel(userId, characterId, updated);
  return updated;
}

// ── Social risk assessment ──────────────────────────────────────────────

export type SocialMoveKind = 'tease' | 'vulnerable_admission' | 'callout' | 'risky_joke' | 'direct_question';

export interface SocialRiskAssessment {
  move: SocialMoveKind;
  risk: 'low' | 'moderate' | 'high';
  reasoning: string;
}

/**
 * Estimate how risky a conversational move would be right now, combining
 * social slack/temperature with overall trust from user-model.ts. Pure
 * function — callers (response-planner.ts, decision-engine.ts) run this
 * before committing to a risky beat, not as a hard gate but as a signal.
 */
export function assessSocialRisk(social: SocialModel, trust: TrustDimension, move: SocialMoveKind): SocialRiskAssessment {
  const trustScore = overallTrust(trust);
  const tempScore = TEMPERATURE_ORDER.indexOf(social.temperature); // 0-4

  const baseRiskByMove: Record<SocialMoveKind, number> = {
    tease: 20,
    vulnerable_admission: 45,
    callout: 55,
    risky_joke: 35,
    direct_question: 15,
  };

  let riskScore = baseRiskByMove[move];
  riskScore -= (social.socialSlack - 50) * 0.3;
  riskScore -= (tempScore - 2) * 8;
  riskScore -= (trustScore - 50) * 0.25;

  const risk: SocialRiskAssessment['risk'] = riskScore <= 20 ? 'low' : riskScore <= 50 ? 'moderate' : 'high';

  const reasoning = risk === 'low'
    ? 'the current warmth and slack make this land safely most of the time'
    : risk === 'moderate'
    ? 'this could go either way given where things stand right now'
    : 'trust or slack is low enough right now that this is more likely to land badly';

  return { move, risk, reasoning };
}

// ── Prompt injection ───────────────────────────────────────────────────

export function formatSocialModelForPrompt(social: SocialModel): string {
  const lines: string[] = ['# The Social Texture Between You Right Now'];
  lines.push(`Current feel: ${social.temperature}, with ${social.socialSlack >= 60 ? 'plenty of room' : social.socialSlack >= 35 ? 'a fair amount of room' : 'not much room right now'} for teasing or risk-taking.`);

  const usableCommonGround = social.commonGround.filter(cg => cg.strength >= 40).sort((a, b) => b.strength - a.strength).slice(0, 4);
  if (usableCommonGround.length) {
    lines.push('Shared references worth calling back to naturally, never explained: ' + usableCommonGround.map(cg => cg.content).join('; '));
  }

  return lines.join('\n');
}

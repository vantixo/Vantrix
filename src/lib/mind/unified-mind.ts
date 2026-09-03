/**
 * Unified Mind — Vantrix
 *
 * Every engine under lib/cognition/ and lib/universe/ computes something
 * true about a character, but each one only knows its own slice: reputation-
 * engine.ts doesn't know the character got robbed last week, character-
 * evolution.ts doesn't know a court case is unresolved, and none of them
 * know whether the character has actually noticed. This file is the one
 * place that reads all of it, in parallel, and folds it into a single
 * MindState — a character's live self-model of how their life is going —
 * plus a FortuneArc that turns "a bunch of unrelated engine outputs" into
 * "rising", "falling", "fortunate", "turbulent", the way a person actually
 * experiences their own life as one story, not a spreadsheet of stats.
 *
 * This does not replace the individual engines or their formatXForPrompt()
 * helpers — reputation-engine.ts, character-evolution.ts, belief-engine.ts,
 * social-graph.ts, crime-engine.ts, court-engine.ts and disaster-engine.ts
 * all stay exactly as they are, still cron-driven, still independently
 * readable. This is a composition layer on top: getUnifiedMind() calls
 * them all, computeFortuneArc() scores the trend, and
 * formatMindForPrompt() is the single block that goes into the system
 * prompt in place of stitching several formatXForPrompt() calls together
 * by hand at each call site.
 *
 * Call sites: chat/stream/route.ts, chat/guest/route.ts, chat/queue/worker.ts
 * — the same three places cognition-engine.ts is wired, and for the same
 * reason (see that file's header: guest/worker previously got none of the
 * secret-tier/memory-test/companion-awareness wiring either — this closes
 * the same class of gap for self-awareness of fortune).
 */

import { logger } from '@/lib/logger';
import { redis } from '@/lib/redis';

import { getCharacterAttributes } from '@/lib/universe/character-evolution';
import type { CharacterAttributes } from '@/types/legacy-systems';

import {
  getReputationState,
  detectReputationTension,
  significantAxes,
  formatReputationForPrompt,
  type ReputationState,
  type ReputationTension,
} from '@/lib/ai/reputation-engine';

import { getSocialLinks } from '@/lib/universe/social-graph';
import type { CompanionSocialLink } from '@/types/world-expansion';

import { getUnresolvedIncidents } from '@/lib/universe/crime-engine';
import { getRecentVerdicts } from '@/lib/universe/court-engine';
import { getActiveDisasters } from '@/lib/universe/disaster-engine';

import { getActiveBeliefs, type Belief } from '@/lib/cognition/belief-engine';
import { getWorkingMemory, type WorkingMemoryState } from '@/lib/cognition/working-memory';

// ── Types ─────────────────────────────────────────────────────────────────

export type FortuneTrend = 'rising' | 'falling' | 'stable' | 'turbulent';
export type FortuneState = 'fortunate' | 'unfortunate' | 'mixed' | 'neutral';

export interface FortuneArc {
  /** -100..100, single composite read of "how is life going right now". */
  index: number;
  trend: FortuneTrend;
  state: FortuneState;
  /** Short factors that fed the score, most-significant first — used to
   *  build the self-narrative, not just logged for debugging. */
  drivers: string[];
}

export interface MindState {
  userId: string;
  characterId: string;
  locationId?: string;
  attributes: CharacterAttributes | null;
  reputation: ReputationState;
  reputationTensions: ReputationTension[];
  socialLinks: CompanionSocialLink[];
  legalTrouble: { unresolvedCrimes: number; recentVerdicts: number; convicted: number };
  disasterExposure: number;
  beliefs: Belief[];
  workingMemory: WorkingMemoryState;
  fortune: FortuneArc;
  computedAt: number;
}

const HISTORY_LEN = 8;

function historyKey(userId: string, characterId: string): string {
  return `vantrix:mind:fortune-history:${userId}:${characterId}`;
}

// ── Fortune scoring ──────────────────────────────────────────────────────

function scoreFortune(input: {
  attributes: CharacterAttributes | null;
  reputationSignificant: ReturnType<typeof significantAxes>;
  tensions: ReputationTension[];
  socialLinks: CompanionSocialLink[];
  legalTrouble: MindState['legalTrouble'];
  disasterExposure: number;
}): { index: number; drivers: string[] } {
  const drivers: string[] = [];
  let score = 0;

  // Material circumstances — wealth tier and confidence are the clearest
  // "how's life going" signal a character has about themselves.
  if (input.attributes) {
    const wealthScore: Record<CharacterAttributes['wealth_tier'], number> = {
      destitute: -35, struggling: -15, modest: 0, comfortable: 12, wealthy: 25, rich: 35, magnate: 40,
    };
    const w = wealthScore[input.attributes.wealth_tier] ?? 0;
    score += w;
    if (Math.abs(w) >= 15) drivers.push(`financially ${input.attributes.wealth_tier}`);

    const confidenceDelta = (input.attributes.confidence - 50) * 0.4;
    score += confidenceDelta;
    if (Math.abs(confidenceDelta) >= 8) {
      drivers.push(confidenceDelta > 0 ? 'feeling confident lately' : 'confidence has been shaky');
    }

    const healthDelta = (input.attributes.health - 70) * 0.3;
    score += healthDelta;
    if (healthDelta <= -12) drivers.push('health has been poor');

    if (input.attributes.addictions.length > 0) {
      score -= 10 * input.attributes.addictions.length;
      drivers.push(`struggling with ${input.attributes.addictions[0]}`);
    }
    if (input.attributes.overcome_addictions.length > 0) {
      score += 6;
      drivers.push('overcame a hard habit');
    }
  }

  // Reputation — how the world actually sees them, weighted by confidence
  // so one loud rumor doesn't outweigh a well-established reputation.
  for (const axis of input.reputationSignificant) {
    const weighted = (axis.score / 100) * (axis.confidence / 100) * 18;
    score += weighted;
    if (Math.abs(weighted) >= 6) {
      drivers.push(`${axis.score > 0 ? 'known for' : 'gaining a reputation for'} ${axis.axis.replace(/_/g, ' ')}`);
    }
  }
  if (input.tensions.length > 0) {
    score -= 5 * input.tensions.length;
    drivers.push('reputation is contested — people see them differently');
  }

  // Legal / criminal exposure — misfortune in the classic sense.
  if (input.legalTrouble.convicted > 0) {
    score -= 20;
    drivers.push('recently convicted of something');
  } else if (input.legalTrouble.unresolvedCrimes > 0) {
    score -= 8;
    drivers.push('an unresolved legal matter hangs over them');
  }

  // Environmental misfortune.
  if (input.disasterExposure > 0) {
    score -= 10 * Math.min(input.disasterExposure, 3);
    drivers.push('caught up in a disaster or crisis');
  }

  // Social standing — isolation vs. a real network.
  if (input.socialLinks.length === 0) {
    score -= 6;
    drivers.push('feeling isolated — few close ties');
  } else if (input.socialLinks.length >= 5) {
    score += 6;
    drivers.push('well-connected socially');
  }

  const index = Math.max(-100, Math.min(100, Math.round(score)));
  drivers.sort((a, b) => 0); // stable order: material → reputation → legal → social, already inserted that way
  return { index, drivers: drivers.slice(0, 5) };
}

async function readFortuneHistory(userId: string, characterId: string): Promise<number[]> {
  try {
    const raw = await redis.get<number[]>(historyKey(userId, characterId));
    return Array.isArray(raw) ? raw : [];
  } catch (err) {
    logger.warn('unified-mind.readFortuneHistory failed', { userId, characterId, err });
    return [];
  }
}

async function writeFortuneHistory(userId: string, characterId: string, history: number[]): Promise<void> {
  try {
    const trimmed = history.slice(-HISTORY_LEN);
    await redis.set(historyKey(userId, characterId), trimmed, { ex: 60 * 60 * 24 * 30 });
  } catch (err) {
    logger.warn('unified-mind.writeFortuneHistory failed', { userId, characterId, err });
  }
}

function classifyTrend(history: number[], current: number): FortuneTrend {
  if (history.length < 2) return 'stable';
  const prev = history[history.length - 1];
  const delta = current - prev;
  const volatility = history.length >= 3
    ? Math.max(...history.slice(-3)) - Math.min(...history.slice(-3))
    : 0;
  if (volatility >= 35) return 'turbulent';
  if (delta >= 8) return 'rising';
  if (delta <= -8) return 'falling';
  return 'stable';
}

function classifyState(index: number): FortuneState {
  if (index >= 15) return 'fortunate';
  if (index <= -15) return 'unfortunate';
  if (Math.abs(index) < 5) return 'neutral';
  return 'mixed';
}

// ── Composition ──────────────────────────────────────────────────────────

/**
 * Build the full unified mind snapshot for one character, for one user's
 * relationship with them. Every sub-fetch is independently try/caught so
 * one engine being down (or a character not yet having e.g. attributes
 * rows) degrades that slice gracefully instead of failing the whole cycle
 * — same tolerance model as chat/stream/route.ts's existing `.catch(() =>
 * [])` fallbacks on getUnlockedTiers/getDueMemoryTest/etc.
 */
export async function getUnifiedMind(
  userId: string,
  characterId: string,
  locationId?: string,
): Promise<MindState> {
  const [
    attributes,
    reputation,
    socialLinks,
    unresolvedCrimes,
    verdicts,
    disasters,
    beliefs,
  ] = await Promise.all([
    getCharacterAttributes(characterId).catch(() => null),
    getReputationState(userId, characterId).catch(() => null),
    getSocialLinks(characterId).catch(() => []),
    locationId ? getUnresolvedIncidents(locationId).catch(() => []) : Promise.resolve([]),
    locationId ? getRecentVerdicts(locationId).catch(() => []) : Promise.resolve([]),
    locationId ? getActiveDisasters(locationId).catch(() => []) : Promise.resolve([]),
    getActiveBeliefs(userId, characterId).catch(() => []),
  ]);

  const repState = reputation ?? { axes: {} as ReputationState['axes'], updatedAt: Date.now() };
  const tensions = reputation ? detectReputationTension(reputation) : [];
  const sig = reputation ? significantAxes(reputation) : [];

  // NOTE: getUnresolvedIncidents()/getRecentVerdicts() select from world_events,
  // which has no character_id (or verdict/outcome) column — crime/court rows are
  // location-scoped, not per-character (see 20240200_world_expansion.sql). The
  // previous `(x as any[]).filter(v => v?.character_id === ...)` here was always
  // filtering on a field that doesn't exist, so unresolvedCrimes/recentVerdicts
  // silently evaluated to 0 regardless of real data. Both calls above are already
  // scoped to the character's own locationId, so the honest fix is to use the
  // (already location-scoped) result counts directly rather than re-filter them.
  // `convicted` specifically can't be derived from this schema — rollVerdict()'s
  // 'convicted' | 'acquitted' | 'dismissed' outcome is only baked into free-text
  // title/description via buildVerdictNarration(), not a structured column — so
  // it's left at 0 rather than guessed at with text matching.
  const legalTrouble = {
    unresolvedCrimes: unresolvedCrimes.length,
    recentVerdicts: verdicts.length,
    convicted: 0,
  };
  const disasterExposure = disasters.length;

  const { index, drivers } = scoreFortune({
    attributes,
    reputationSignificant: sig,
    tensions,
    socialLinks,
    legalTrouble,
    disasterExposure,
  });

  const history = await readFortuneHistory(userId, characterId);
  const trend = classifyTrend(history, index);
  const state = classifyState(index);
  await writeFortuneHistory(userId, characterId, [...history, index]);

  const workingMemory = getWorkingMemory(userId, characterId);

  return {
    userId,
    characterId,
    locationId,
    attributes,
    reputation: repState,
    reputationTensions: tensions,
    socialLinks,
    legalTrouble,
    disasterExposure,
    beliefs,
    workingMemory,
    fortune: { index, trend, state, drivers },
    computedAt: Date.now(),
  };
}

// ── Prompt formatting ────────────────────────────────────────────────────

const TREND_PHRASE: Record<FortuneTrend, string> = {
  rising: 'Things have been looking up recently',
  falling: 'Things have been going downhill recently',
  stable: 'Life has been steady lately',
  turbulent: 'Life has been unpredictable lately — good and bad swinging fast',
};

/**
 * The single self-awareness block for the system prompt. This is meant to
 * replace ad-hoc concatenation of formatReputationForPrompt() +
 * formatAttributesForPrompt() + formatSocialGraphForPrompt() at each call
 * site with one coherent paragraph the character can actually speak from
 * — "aware of their own arc," not a stat sheet.
 */
export function formatMindForPrompt(mind: MindState): string {
  const lines: string[] = [];
  lines.push(`[SELF-AWARENESS — how your life has been going]`);
  lines.push(`${TREND_PHRASE[mind.fortune.trend]}. Overall you'd call it ${mind.fortune.state}.`);
  if (mind.fortune.drivers.length > 0) {
    lines.push(`Specifically: ${mind.fortune.drivers.join('; ')}.`);
  }
  if (mind.legalTrouble.convicted > 0) {
    lines.push(`You were recently found guilty of something — it weighs on you.`);
  } else if (mind.legalTrouble.unresolvedCrimes > 0) {
    lines.push(`There's an unresolved legal matter hanging over you.`);
  }
  if (mind.disasterExposure > 0) {
    lines.push(`You've recently been affected by a disaster or crisis in your city.`);
  }
  const repText = formatReputationForPrompt(significantAxesFromState(mind.reputation), mind.reputationTensions);
  if (repText) lines.push(repText);
  lines.push(
    `Let this color your mood and what you bring up unprompted — you are aware of how your ` +
    `own fortunes have been trending, the way a person is aware of whether their year has been ` +
    `good or bad, even without being asked.`,
  );
  return lines.join('\n');
}

function significantAxesFromState(state: ReputationState) {
  try {
    return significantAxes(state);
  } catch {
    return [];
  }
}

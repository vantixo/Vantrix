/**
 * Prediction Engine — Vantrix Cognition Layer
 *
 * Everything upstream of this module (emotion-engine.ts, confidence-engine.ts,
 * drive-engine.ts) describes *this turn*. Nothing forecasts forward: whether
 * a rough patch is trending toward repair or toward disengagement, whether
 * the user is likely to come back tomorrow, whether the relationship's
 * current trajectory is heading toward a stage-up soon or has stalled. This
 * module is a small, cheap forecaster over a short window of recent
 * EmotionalState/RelationshipState snapshots — linear trend-reading, not a
 * model. Its job is to turn "here's where things have been" into "here's
 * where they're probably headed", so executive-controller.ts and
 * metacognition.ts have something to act on before a problem is already
 * visible in the current turn.
 *
 * Predictions here are deliberately soft — a direction and a confidence,
 * never a hard claim — and are never injected into the prompt as fact.
 * Downstream callers use them to bias goal/task selection (e.g. weighting
 * a repair-oriented goal higher when disengagementRisk is climbing), not
 * to narrate them to the user.
 */

import { logger } from '@/lib/logger';
import type { EmotionalState } from '@/lib/ai/emotion-engine';
import type { RelationshipState } from '@/lib/ai/relationship-engine';

// ── Types ───────────────────────────────────────────────────────────────

export interface HistorySnapshot {
  turn: number;
  emotion: EmotionalState;
  relationshipHealth: number; // mirrors RelationshipState.health, 0-100
  hoursSincePrevious: number;
}

export type Trend = 'improving' | 'stable' | 'declining';

export interface PredictionInput {
  userId: string;
  characterId: string;
  /** Most recent snapshots, oldest first. A handful (3-6) is enough —
   *  this is trend-reading, not a long-horizon model. */
  recent: HistorySnapshot[];
  relationship: RelationshipState;
}

export interface PredictionResult {
  valenceTrend: Trend;
  /** 0-1. Rising when valence is trending down and the gaps between
   *  turns are widening — the two things that, together, most often
   *  precede a user going quiet. Either signal alone is normal noise. */
  disengagementRisk: number;
  /** 0-1. Rising when relationship health is climbing steadily and
   *  stage_xp is close to its cap — a soft heads-up that a stage-up
   *  moment may be near, distinct from progression's own hard trigger. */
  stageUpLikelihood: number;
  /** How much weight to put on the above — low when there isn't enough
   *  history yet to say anything meaningful. */
  confidence: number;
  promptBlock: string;
}

const MIN_SNAPSHOTS_FOR_TREND = 3;
const TREND_EPSILON = 0.05; // valence deltas smaller than this count as flat

// ── Core ────────────────────────────────────────────────────────────────

export function predict(input: PredictionInput): PredictionResult {
  const { recent, relationship } = input;

  if (recent.length < MIN_SNAPSHOTS_FOR_TREND) {
    return {
      valenceTrend: 'stable',
      disengagementRisk: 0,
      stageUpLikelihood: 0,
      confidence: 0,
      promptBlock: '',
    };
  }

  const valences = recent.map(s => s.emotion.valence);
  const slope = linearSlope(valences);
  const valenceTrend: Trend =
    slope > TREND_EPSILON ? 'improving' : slope < -TREND_EPSILON ? 'declining' : 'stable';

  const gapTrend = linearSlope(recent.map(s => s.hoursSincePrevious));
  const gapsWidening = gapTrend > 0;

  const disengagementRisk = clamp01(
    (valenceTrend === 'declining' ? 0.5 : 0) +
    (gapsWidening ? 0.3 : 0) +
    (relationship.jealousy_level > 70 ? 0.2 : 0),
  );

  const capProximity = relationship.stage_xp_cap === Infinity
    ? 0
    : clamp01(relationship.stage_xp / relationship.stage_xp_cap);
  // BUG FIX: health isn't tracked per-turn, so this used to approximate a
  // trend via a synthetic series built from a single relationship.health
  // reading. That series was monotonically increasing by construction —
  // verified: its slope is exactly 1.0 regardless of the actual health
  // value or history length — so `healthSlope > 0` was always true, an
  // unconditional +0.3 masquerading as a real trend read. The comment
  // here originally claimed the approximation was "combined with valence
  // direction," but valence was never actually referenced in the old
  // formula. Now genuinely uses the already-computed valenceTrend (see
  // above) as the proxy the comment always intended.
  const healthTrendPositive = valenceTrend === 'improving';
  const stageUpLikelihood = clamp01(
    (healthTrendPositive ? 0.3 : 0) + capProximity * 0.7,
  );

  const confidence = clamp01((recent.length - MIN_SNAPSHOTS_FOR_TREND + 1) / 4);

  const result: PredictionResult = {
    valenceTrend,
    disengagementRisk,
    stageUpLikelihood,
    confidence,
    promptBlock: '', // never surfaced directly — see header
  };

  if (disengagementRisk > 0.6) {
    logger.info('[cognition/prediction-engine] elevated disengagement risk', {
      userId: input.userId, characterId: input.characterId, disengagementRisk, valenceTrend,
    });
  }

  return result;
}

/** Least-squares slope over an evenly-spaced series — positive means
 *  rising, negative means falling. Returns 0 for series too short to
 *  have a meaningful slope. */
function linearSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const xs = Array.from({ length: n }, (_, i) => i);
  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xMean) * (values[i] - yMean);
    den += (xs[i] - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

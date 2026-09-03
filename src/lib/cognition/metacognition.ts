/**
 * Metacognition — Vantrix Cognition Layer
 *
 * Every other module in this directory produces a read on the turn or
 * the user. This one is the only one that looks at the cognition layer
 * itself: is confidence-engine.ts's stated confidence actually tracking
 * outcomes, or is it consistently overconfident on some domain? Is
 * task-manager.ts's active task getting attempted turn after turn
 * without ever landing? Is the same plan step in planner.ts stalling?
 * Those are strategy failures, not conversational ones — response
 * quality can be fine while the cognition layer keeps pushing on
 * something that isn't working. This module keeps a short rolling
 * record of (predicted vs actual) and (attempted vs resolved) outcomes
 * and turns repeated misses into a concrete suggestion: lower confidence
 * on a domain, drop a stalled task/plan, or stop retrying a goal.
 *
 * It does not change anything itself — it's read-only judgment over
 * history that other modules (executive-controller.ts, planner.ts) can
 * choose to act on. That keeps the actual state mutations owned by the
 * modules that already own that state, and keeps this module cheap to
 * reason about (it can never itself corrupt task/plan/confidence state).
 */

import { logger } from '@/lib/logger';

// ── Types ───────────────────────────────────────────────────────────────

export interface OutcomeRecord {
  turn: number;
  /** What kind of prediction/attempt this was — free-text provenance,
   *  same convention as reasoning-engine.ts's Claim.source. */
  domain: string;
  /** True if the read/attempt panned out, false if it didn't. */
  succeeded: boolean;
  /** The confidence that was stated at the time, if this record is
   *  tracking calibration rather than a plain attempt/resolve. */
  statedConfidence?: number;
}

export interface CalibrationReport {
  domain: string;
  sampleSize: number;
  /** Mean stated confidence vs actual success rate over the window.
   *  Positive means overconfident, negative means underconfident. */
  overconfidenceGap: number;
  recommendation: 'trust' | 'hedge_more' | 'hedge_less';
}

export interface StallReport {
  domain: string;
  consecutiveFailures: number;
  recommendation: 'continue' | 'reconsider' | 'abandon';
}

const WINDOW = 20; // records kept per (participant, domain)
const MIN_SAMPLE_FOR_CALIBRATION = 5;
const OVERCONFIDENCE_THRESHOLD = 0.2;
const RECONSIDER_AFTER = 2;
const ABANDON_AFTER = 4;

const store = new Map<string, OutcomeRecord[]>();

function key(userId: string, characterId: string): string {
  return `${userId}::${characterId}`;
}

// ── Writes ──────────────────────────────────────────────────────────────

export function recordOutcome(userId: string, characterId: string, record: OutcomeRecord): void {
  const k = key(userId, characterId);
  const list = store.get(k) ?? [];
  list.push(record);
  if (list.length > WINDOW * 4) {
    // Trim globally so one noisy domain can't crowd out the window for
    // every other domain sharing this participant's store.
    list.splice(0, list.length - WINDOW * 4);
  }
  store.set(k, list);
}

// ── Reads ───────────────────────────────────────────────────────────────

/**
 * Compare stated confidence against actual outcomes for a domain over
 * the recent window. Returns null if there isn't enough history yet to
 * say anything meaningful — callers should treat that as "no adjustment,
 * keep trusting confidence-engine.ts as-is" rather than a negative signal.
 */
export function checkCalibration(
  userId: string,
  characterId: string,
  domain: string,
): CalibrationReport | null {
  const records = recentFor(userId, characterId, domain).filter(r => r.statedConfidence !== undefined);
  if (records.length < MIN_SAMPLE_FOR_CALIBRATION) return null;

  const meanStated = records.reduce((sum, r) => sum + (r.statedConfidence ?? 0), 0) / records.length;
  const successRate = records.filter(r => r.succeeded).length / records.length;
  const overconfidenceGap = meanStated - successRate;

  const recommendation: CalibrationReport['recommendation'] =
    overconfidenceGap > OVERCONFIDENCE_THRESHOLD ? 'hedge_more'
    : overconfidenceGap < -OVERCONFIDENCE_THRESHOLD ? 'hedge_less'
    : 'trust';

  if (recommendation !== 'trust') {
    logger.info('[cognition/metacognition] confidence miscalibrated', {
      userId, characterId, domain, overconfidenceGap, recommendation,
    });
  }

  return { domain, sampleSize: records.length, overconfidenceGap, recommendation };
}

/**
 * Look for a domain (typically a goal id or task id) that's failed
 * several times in a row recently, with nothing resolved in between.
 * A single failure is normal — persistence across several is the signal
 * something about the approach, not the moment, is wrong.
 */
export function checkStall(userId: string, characterId: string, domain: string): StallReport {
  const records = recentFor(userId, characterId, domain);
  let consecutiveFailures = 0;
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i].succeeded) break;
    consecutiveFailures++;
  }

  const recommendation: StallReport['recommendation'] =
    consecutiveFailures >= ABANDON_AFTER ? 'abandon'
    : consecutiveFailures >= RECONSIDER_AFTER ? 'reconsider'
    : 'continue';

  return { domain, consecutiveFailures, recommendation };
}

function recentFor(userId: string, characterId: string, domain: string): OutcomeRecord[] {
  const all = store.get(key(userId, characterId)) ?? [];
  return all.filter(r => r.domain === domain).slice(-WINDOW);
}

/** Prompt-ready hedge guidance for a domain, if calibration suggests one
 *  is warranted — mirrors uncertainty-engine.ts's convention of only
 *  ever injecting the already-converted guidance, never a raw number. */
export function formatCalibrationForPrompt(report: CalibrationReport | null): string {
  if (!report || report.recommendation === 'trust') return '';
  return report.recommendation === 'hedge_more'
    ? `Recent read on "${report.domain}" has been overconfident — lean more tentative here than usual.`
    : `Recent read on "${report.domain}" has been under-trusted relative to how often it's been right — no need to over-hedge here.`;
}

/** Test/reset hook. */
export function resetMetacognition(userId: string, characterId: string): void {
  store.delete(key(userId, characterId));
}

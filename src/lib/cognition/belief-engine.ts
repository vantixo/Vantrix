/**
 * Belief Engine — Vantrix Cognition Layer
 *
 * Public entry point for the belief subsystem. Same role for
 * belief-store/update/conflict/decay that cognition-engine.ts plays for
 * the rest of src/lib/cognition/: callers outside this directory should
 * import from here, not reach into the individual files.
 *
 *   belief-engine.ts   (this file) — public entry point, orchestration
 *   belief-update.ts               — pure reconciliation math (no I/O)
 *   belief-conflict.ts             — pure conflict decision (no I/O)
 *   belief-decay.ts                — pure time-decay math (no I/O)
 *   belief-store.ts                — the only file that touches Supabase/Redis
 *   belief-types.ts                — shared shapes
 *
 * Two entry points matter to callers:
 *
 *   recordBelief()        — call this from wherever new evidence about the
 *                            user is produced (the same extraction call
 *                            sites feeding user-fact-graph.ts today, or a
 *                            structured signal like theory-of-mind.ts's
 *                            MindSignal once it's classified into a
 *                            BeliefEvidence). Runs decay-on-read against
 *                            the current subject first (so a stale belief
 *                            doesn't win a conflict it's no longer earning),
 *                            then reconciles and persists.
 *
 *   getActiveBeliefs()     — call this wherever beliefs should be read for
 *                            prompt injection or reasoning (e.g. feeding
 *                            theory-of-mind.ts's reconcile() as additional
 *                            ground truth). Returns only 'active' status,
 *                            highest confidence first, and touches
 *                            lastUsedAt on the ones actually returned so
 *                            decay accounts for real usage.
 *
 * runBeliefMaintenance() is the cron-driven sweep (same shape as
 * priority-memory.ts / surprise-engine.ts's scheduled passes) that decays
 * the *whole* stored set, including subjects that haven't been touched by
 * recordBelief in a while — recordBelief only decays the one subject it's
 * about, so beliefs on subjects nobody brings up again would otherwise
 * never fade without this.
 */

import { logger } from '@/lib/logger';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  getAllBeliefs,
  insertBelief,
  updateBelief,
  updateBeliefsBulk,
} from '@/lib/cognition/belief-store';
import { planUpdate } from '@/lib/cognition/belief-update';
import { decayBelief, decayBeliefSet, touchBelief } from '@/lib/cognition/belief-decay';
import type { Belief, BeliefEvidence, BeliefCategory } from '@/lib/cognition/belief-types';

export type {
  Belief,
  BeliefEvidence,
  BeliefCategory,
  BeliefPolarity,
  BeliefSource,
  BeliefStatus,
} from '@/lib/cognition/belief-types';
export type { ConflictDecision, ConflictResult } from '@/lib/cognition/belief-conflict';
export type { UpdatePlan } from '@/lib/cognition/belief-update';

// Injection priority by category — same rationale/ordering as
// user-fact-graph.ts's CATEGORY_PRIORITY, kept in sync deliberately so
// the two systems don't disagree about what matters most if both end up
// feeding the same prompt section.
const CATEGORY_PRIORITY: Record<BeliefCategory, number> = {
  pain_point: 10,
  family: 9,
  relationship: 8,
  aspiration: 7,
  opinion: 6,
  work: 5,
  location: 4,
  hobby: 3,
  preference: 2,
  trait: 1,
};

// ── Write path ──────────────────────────────────────────────────────────

export interface RecordBeliefResult {
  belief: Belief | null;
  decision: string;
  reason: string;
}

/**
 * Reconcile one piece of new evidence against whatever's currently stored
 * for that subject, persist the outcome, and return the resulting belief
 * (the winning/reinforced one — null only if evidence was dropped because
 * an existing belief clearly outweighed it).
 */
export async function recordBelief(
  userId: string,
  characterId: string,
  evidence: BeliefEvidence,
): Promise<RecordBeliefResult> {
  const all = await getAllBeliefs(userId, characterId);

  const existingRaw = all.find(b => b.subject === evidence.subject && (b.status === 'active' || b.status === 'unresolved')) ?? null;
  // Decay-on-read for just this one subject before it competes in a
  // conflict — a belief that's gone quiet for months shouldn't out-weigh
  // fresh evidence purely because it was once reinforced a lot.
  const existing = existingRaw ? decayBelief(existingRaw) : null;

  const plan = planUpdate(userId, characterId, evidence, existing);

  let persisted: Belief | null = null;

  if (plan.update) {
    persisted = await updateBelief(plan.update);
  }
  if (plan.insert) {
    const inserted = await insertBelief(plan.insert);
    // Prefer returning the newly inserted/replacing belief when both an
    // insert and update happened (replace/unresolved cases) — that's the
    // one callers care about going forward.
    if (inserted) persisted = inserted;
  }

  logger.info('belief-engine:recorded', {
    userId, characterId, subject: evidence.subject, decision: plan.conflict.decision,
  });

  return { belief: persisted, decision: plan.conflict.decision, reason: plan.conflict.reason };
}

/** Convenience for extraction pipelines that already produce several
 *  pieces of evidence from one message (mirrors user-fact-graph.ts's
 *  batch shape). Processed sequentially, not in parallel — each one may
 *  change what the next should reconcile against if they share a subject. */
export async function recordBeliefs(
  userId: string,
  characterId: string,
  evidenceList: BeliefEvidence[],
): Promise<RecordBeliefResult[]> {
  const results: RecordBeliefResult[] = [];
  for (const evidence of evidenceList) {
    results.push(await recordBelief(userId, characterId, evidence));
  }
  return results;
}

// ── Read path ───────────────────────────────────────────────────────────

/**
 * Live beliefs only, decayed-on-read (not persisted here — that's what
 * runBeliefMaintenance is for), highest confidence first. Does not touch
 * lastUsedAt by itself; call markBeliefsUsed() with whichever subset
 * actually gets surfaced into a prompt.
 */
export async function getActiveBeliefs(userId: string, characterId: string): Promise<Belief[]> {
  const all = await getAllBeliefs(userId, characterId);
  const now = Date.now();

  return all
    .filter(b => b.status === 'active' || b.status === 'unresolved')
    .map(b => decayBelief(b, now))
    .filter(b => b.status === 'active' || b.status === 'unresolved')
    .sort((a, b) => b.confidence - a.confidence);
}

/** Record that these beliefs were actually surfaced this turn — resets
 *  their decay clock. Fire-and-forget; callers shouldn't block a response
 *  on this write. */
export async function markBeliefsUsed(beliefs: Belief[]): Promise<void> {
  if (beliefs.length === 0) return;
  const touched = beliefs.map(b => touchBelief(b));
  await updateBeliefsBulk(touched);
}

// ── Maintenance sweep ───────────────────────────────────────────────────

export interface MaintenanceReport {
  scanned: number;
  changed: number;
  newlyDecayed: number;
}

/**
 * Decay the entire stored belief set for one (user, character), including
 * subjects that haven't come up recently. Intended to be cron-driven
 * (weekly is plenty given the shortest half-life above is 60 days) rather
 * than called per-request.
 */
export async function runBeliefMaintenance(userId: string, characterId: string): Promise<MaintenanceReport> {
  const all = await getAllBeliefs(userId, characterId);
  const changed = decayBeliefSet(all);
  const newlyDecayed = changed.filter(b => b.status === 'decayed').length;

  if (changed.length > 0) {
    await updateBeliefsBulk(changed);
  }

  logger.info('belief-engine:maintenance', {
    userId, characterId, scanned: all.length, changed: changed.length, newlyDecayed,
  });

  return { scanned: all.length, changed: changed.length, newlyDecayed };
}

export interface BeliefMaintenanceCronReport {
  pairsScanned:  number;
  pairsFailed:   number;
  totalScanned:  number;
  totalChanged:  number;
  totalDecayed:  number;
}

/**
 * Batched entry point for a weekly cron: runs runBeliefMaintenance() over
 * every (user, character) pair that actually has stored beliefs, rather
 * than every active relationship — most relationships have none yet (see
 * cognition-engine.ts's "starts genuinely empty" framing), and sweeping
 * those would just be wasted round-trips. Distinct pairs are read
 * directly off user_beliefs rather than via character_psychology (the
 * table character-initiative.ts's runInitiativeCron() sweeps) since a
 * relationship can have interactions without ever having produced belief
 * evidence, and vice versa isn't possible — user_beliefs is the more
 * precise source of "who actually needs this."
 *
 * One (user, character) pair failing doesn't stop the sweep — same
 * fail-open-per-item posture as runInitiativeCron(), logged and counted
 * rather than thrown.
 */
export async function runBeliefMaintenanceCron(): Promise<BeliefMaintenanceCronReport> {
  const report: BeliefMaintenanceCronReport = {
    pairsScanned: 0, pairsFailed: 0, totalScanned: 0, totalChanged: 0, totalDecayed: 0,
  };

  const { data: rows, error } = await supabaseAdmin
    .from('user_beliefs')
    .select('user_id,character_id');

  if (error || !rows) {
    logger.error('belief-engine:maintenance-cron:fetch-failed', { error: error?.message });
    return report;
  }

  // Dedup pairs client-side — Supabase's query builder doesn't have a
  // clean DISTINCT-on-two-columns here without a raw SQL view, and the
  // row count for a "which pairs have beliefs" scan is small enough
  // (bounded by relationship count, not belief count) that this is
  // cheap.
  const pairs = new Map<string, { userId: string; characterId: string }>();
  for (const row of rows) {
    const key = `${row.user_id}:${row.character_id}`;
    if (!pairs.has(key)) pairs.set(key, { userId: row.user_id, characterId: row.character_id });
  }

  for (const { userId, characterId } of pairs.values()) {
    try {
      const result = await runBeliefMaintenance(userId, characterId);
      report.pairsScanned += 1;
      report.totalScanned += result.scanned;
      report.totalChanged += result.changed;
      report.totalDecayed += result.newlyDecayed;
    } catch (err) {
      report.pairsFailed += 1;
      logger.warn('belief-engine:maintenance-cron:pair-failed', {
        userId, characterId, error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('belief-engine:maintenance-cron:complete', { ...report });
  return report;
}

// ── Prompt injection ───────────────────────────────────────────────────

/**
 * Prompt-ready rendering, grouped and ordered the same way
 * user-fact-graph.ts's formatFactGraphForPrompt is, plus a confidence
 * hedge so a 0.2-confidence belief doesn't get stated with the same
 * certainty as a 0.9 one.
 */
export function formatBeliefsForPrompt(beliefs: Belief[]): string {
  if (beliefs.length === 0) return '';

  const sorted = [...beliefs].sort((a, b) => {
    const pa = CATEGORY_PRIORITY[a.category] ?? 0;
    const pb = CATEGORY_PRIORITY[b.category] ?? 0;
    return pb - pa || b.confidence - a.confidence;
  });

  const grouped = sorted.reduce<Partial<Record<BeliefCategory, Belief[]>>>((acc, b) => {
    (acc[b.category] ??= []).push(b);
    return acc;
  }, {});

  const lines: string[] = ['What you believe about this person (may include things you\'re not fully sure of):'];

  for (const [category, catBeliefs] of Object.entries(grouped)) {
    const label = category.replace('_', ' ');
    const rendered = catBeliefs!.slice(0, 3).map((b) => {
      const hedge = b.confidence >= 0.7 ? '' : b.confidence >= 0.4 ? ' (fairly sure)' : ' (not certain — she said this once, in passing)';
      const negate = b.polarity === 'negates' ? 'NOT: ' : '';
      return `${negate}${b.statement}${hedge}`;
    }).join('; ');
    lines.push(`  ${label}: ${rendered}`);
  }

  lines.push('Let low-confidence items shape curiosity or gentle checking-in, not confident statements.');
  return lines.join('\n');
}

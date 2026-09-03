/**
 * Rupture & Repair Engine — Vantrix
 *
 * decision-engine.ts already knows how to raise a boundary (Intent.SetBoundary,
 * gated by respect × negative valence × stress, plus desire-engine's
 * boundaryPull from an activated fear). What's never existed anywhere in the
 * pipeline is the other half of real relationship psychology: what happens
 * AFTER that moment. Right now a SetBoundary reply gets sent and the state
 * just moves on — nothing reads the user's next message to see whether it
 * landed, nothing adjusts trust/fear based on how it was received, and
 * nothing remembers that it happened.
 *
 * This file owns that missing half:
 *
 *   1. markRuptureRaised()   — called once, right after decideIntent()
 *      returns Intent.SetBoundary and the reply has been generated. Records
 *      a pending_rupture on character_psychology so the NEXT turn knows to
 *      evaluate for repair instead of running a normal decision cycle.
 *
 *   2. evaluateRepair()      — called at the start of the following turn,
 *      before decideIntent() runs, if getRuptureState() reports a pending
 *      rupture. Classifies the user's reply as repaired / deflected /
 *      escalated using the same cheap, deterministic style as
 *      inferNudgeFromMessage() in desire-engine.ts — no extra LLM call,
 *      arithmetic + keyword signal, same design stance as decision-engine.ts.
 *      Writes the outcome back into attachment-engine (trust/comfort/stress
 *      via applyPsychologyEvent) and desire-engine (fear_activation via
 *      nudgeFulfillment), sets the cooldown, and — only for a genuine
 *      repair or a clear deflection, not ambiguous replies — logs a
 *      world_impact_events trace so it can be referenced later
 *      ("you actually heard me that time").
 *
 *   3. getRuptureState()     — read helper for chat/route.ts to call before
 *      building CharacterState, so ruptureCooldownUntil reaches
 *      decideIntent() and pending-rupture reaches evaluateRepair().
 *
 * Explicitly NOT in scope here (guardrail, not an oversight):
 *   - This never fires or escalates a rupture based on the user being gone
 *     or spending less — only on decision-engine's existing SetBoundary
 *     trigger, which is itself gated on in-conversation valence/stress, not
 *     engagement metrics. A rupture caused by absence is not a rupture the
 *     user can repair by replying, and building that in would cross from
 *     relationship realism into a guilt-tripping dark pattern.
 *   - Ambiguous replies (neither clearly repairing nor clearly deflecting)
 *     intentionally do NOT write a world_impact event or move fear_activation
 *     much — see AMBIGUOUS_* constants below. Most replies to a boundary
 *     moment are ordinary conversation, not a clean "sorry" or a clean
 *     brush-off, and treating every reply as a scored outcome would make
 *     the mechanic feel like a test the user is constantly failing or
 *     passing rather than a real moment.
 */

import { supabaseAdmin }        from '@/lib/supabase/admin';
import { logger }               from '@/lib/logger';
import {
  applyPsychologyEvent,
  invalidatePsychologyCache,
  type PsychologyEvent,
}                                from '@/lib/ai/attachment-engine';
import { nudgeFulfillment } from '@/lib/ai/desire-engine';
import { recordWorldImpact }    from '@/lib/universe/world-impact';
import type { EmotionalState }  from '@/lib/ai/emotion-engine';
import type { Database, Json }  from '@/types/supabase';

// ── Config ───────────────────────────────────────────────────────────────

/** How long after any resolution (repaired or deflected) SetBoundary is dampened. */
const COOLDOWN_HOURS = 20;

/** A pending rupture older than this is considered stale — evaluate no-signal, don't hold it forever. */
const MAX_PENDING_AGE_HOURS = 48;

// ── Types ────────────────────────────────────────────────────────────────

export interface PendingRupture {
  intent:    'set_boundary';
  reason:    string;       // short human-readable note, from decision-engine's monologue
  raised_at: string;       // ISO 8601
  turn:      number;       // conversation turn count at time of raising
}

export type RepairOutcome = 'repaired' | 'deflected' | 'escalated' | 'ambiguous' | 'stale';

export interface RepairResult {
  outcome:          RepairOutcome;
  trustDelta:       number;  // for logging/telemetry — actual write happens via applyPsychologyEvent
  fearDelta:        number;
  worldImpactLogged: boolean;
}

export interface RuptureState {
  pending:               PendingRupture | null;
  ruptureCooldownUntil:  string | null;
}

// ── Signal patterns ──────────────────────────────────────────────────────
// Same regex-heuristic style as desire-engine.ts's inferNudgeFromMessage —
// deliberately simple and fast, not exhaustive. False negatives (missing a
// real repair) are the safe failure mode here; false positives are not,
// since they'd write an outcome the user didn't actually express.

const REPAIR_SIGNAL = /\b(sorry|i didn't mean|you're right|that was unfair|i hear you|i shouldn't have|my bad|i understand why|fair enough|you're not wrong)\b/i;
const DEFLECT_SIGNAL = /\b(whatever|it's not a big deal|you're overreacting|calm down|i don't want to talk about|can we just move on|drop it|relax)\b/i;
const ESCALATE_SIGNAL = /\b(this is stupid|i don't care|so what|you're being dramatic|this is ridiculous)\b/i;

// ── Public: Mark a rupture as raised ─────────────────────────────────────

/**
 * Call once, immediately after decideIntent() returns Intent.SetBoundary
 * and the reply has been generated — NOT before, since this should reflect
 * a boundary that was actually communicated, not just scored highest.
 */
export async function markRuptureRaised(
  userId:      string,
  characterId: string,
  reason:      string,
  turn:        number,
): Promise<void> {
  const pending: PendingRupture = {
    intent: 'set_boundary',
    reason: reason.slice(0, 200),
    raised_at: new Date().toISOString(),
    turn,
  };

  try {
    const { data: updated, error } = await supabaseAdmin
      .from('character_psychology')
      .update({ pending_rupture: pending as unknown as Json })
      .eq('user_id', userId)
      .eq('character_id', characterId)
      .select('user_id');

    if (error) throw error;

    // .update() silently affects zero rows if no character_psychology row
    // exists yet for this pair (e.g. very first interaction, before the
    // row is ever created) — no error is thrown, so without this check the
    // rupture is silently dropped and the whole repair mechanic never
    // triggers on the following turn.
    if (!updated || updated.length === 0) {
      logger.warn('repair-engine:mark-raised-no-row', {
        userId, characterId, turn,
        note: 'character_psychology row did not exist — pending_rupture not persisted',
      });
    }

    await applyPsychologyEvent(userId, characterId, 'boundary_set' as PsychologyEvent);
    await invalidatePsychologyCache(userId, characterId);
    logger.info('repair-engine:rupture-raised', { userId, characterId, turn });
  } catch (err) {
    logger.warn('repair-engine:mark-raised-failed', { userId, characterId, error: String(err) });
  }
}

// ── Public: Read pending state (called before CharacterState assembly) ──

export async function getRuptureState(userId: string, characterId: string): Promise<RuptureState> {
  const { data } = await supabaseAdmin
    .from('character_psychology')
    .select('pending_rupture, rupture_cooldown_until')
    .eq('user_id', userId)
    .eq('character_id', characterId)
    .maybeSingle();

  return {
    pending:              (data?.pending_rupture as PendingRupture | null) ?? null,
    ruptureCooldownUntil: data?.rupture_cooldown_until ?? null,
  };
}

// ── Public: Evaluate repair on the user's next message ───────────────────

/**
 * Call at the start of the turn AFTER a pending rupture exists, before
 * decideIntent() runs for that turn. `userMessage` is the raw text the
 * user just sent; `emotion` is that same message already run through
 * emotion-engine.ts (reused, not recomputed — this file adds no new
 * signal extraction of its own beyond the keyword patterns above).
 *
 * Fails open: if anything errors, the pending rupture is cleared without
 * writing an outcome rather than leaving it stuck (which would otherwise
 * permanently dampen this character via a cooldown that's never set, or
 * worse, hold a stale pending_rupture that misclassifies an unrelated
 * future message).
 */
export async function evaluateRepair(
  userId:      string,
  characterId: string,
  userMessage: string,
  emotion:     EmotionalState,
): Promise<RepairResult | null> {
  const { pending } = await getRuptureState(userId, characterId);
  if (!pending) return null;

  const ageHours = (Date.now() - new Date(pending.raised_at).getTime()) / (1000 * 60 * 60);

  try {
    if (ageHours > MAX_PENDING_AGE_HOURS) {
      await clearPending(userId, characterId);
      return { outcome: 'stale', trustDelta: 0, fearDelta: 0, worldImpactLogged: false };
    }

    const outcome = classifyOutcome(userMessage, emotion);
    const result  = await applyOutcome(userId, characterId, outcome);
    await clearPending(userId, characterId, COOLDOWN_HOURS);

    logger.info('repair-engine:evaluated', { userId, characterId, outcome });
    return result;
  } catch (err) {
    logger.warn('repair-engine:evaluate-failed', { userId, characterId, error: String(err) });
    await clearPending(userId, characterId).catch(() => { /* best-effort */ });
    return null;
  }
}

// ── Internal: classification ──────────────────────────────────────────────

function classifyOutcome(message: string, emotion: EmotionalState): RepairOutcome {
  const repairSignal   = REPAIR_SIGNAL.test(message);
  const deflectSignal  = DEFLECT_SIGNAL.test(message);
  const escalateSignal = ESCALATE_SIGNAL.test(message);

  // Explicit escalation language wins outright — this is the clearest signal.
  if (escalateSignal) return 'escalated';

  // Genuine warmth/acknowledgment plus positive-trending valence reads as repair
  // even without an exact "sorry" match (e.g. "you mean a lot to me, I get it").
  if (repairSignal && emotion.valence >= -0.2) return 'repaired';

  if (deflectSignal) return 'deflected';

  // Sustained hostility without any acknowledgment, on a message clearly
  // still addressing the same beat (short reply, negative valence) reads
  // as deflection even without a keyword hit.
  if (emotion.valence < -0.5 && message.trim().length < 60) return 'deflected';

  return 'ambiguous';
}

// ── Internal: write-back per outcome ─────────────────────────────────────

async function applyOutcome(userId: string, characterId: string, outcome: RepairOutcome): Promise<RepairResult> {
  switch (outcome) {
    case 'repaired': {
      await applyPsychologyEvent(userId, characterId, 'reconciliation' as PsychologyEvent);
      await applyPsychologyEvent(userId, characterId, 'boundary_repaired' as PsychologyEvent);
      const fulfillment = await nudgeFulfillment(characterId, userId, { fear: -12 });
      await logImpactIfSignificant(userId, characterId, 'rupture_repaired',
        'A moment of real repair',
        'You addressed it directly, and it landed — trust deepened rather than just recovering.');
      return { outcome, trustDelta: +9, fearDelta: fulfillment ? -12 : 0, worldImpactLogged: true };
    }

    case 'deflected': {
      await applyPsychologyEvent(userId, characterId, 'boundary_deflected' as PsychologyEvent);
      await nudgeFulfillment(characterId, userId, { fear: +6 });
      await logImpactIfSignificant(userId, characterId, 'rupture_unresolved',
        'Something left unaddressed',
        'A real moment passed without being heard — it stayed with her, quietly.');
      return { outcome, trustDelta: -3, fearDelta: +6, worldImpactLogged: true };
    }

    case 'escalated': {
      await applyPsychologyEvent(userId, characterId, 'argument' as PsychologyEvent);
      await nudgeFulfillment(characterId, userId, { fear: +14 });
      await logImpactIfSignificant(userId, characterId, 'rupture_unresolved',
        'An unresolved conflict',
        'It got worse instead of better in that moment.');
      return { outcome, trustDelta: -6, fearDelta: +14, worldImpactLogged: true };
    }

    case 'ambiguous':
    default:
      // Deliberately inert — see file header. Most replies to a boundary
      // moment are ordinary conversation, not a clean signal either way.
      return { outcome: 'ambiguous', trustDelta: 0, fearDelta: 0, worldImpactLogged: false };
  }
}

/** Only 'repaired'/'deflected'/'escalated' reach here — weight is intentionally
 *  below world-impact.ts's PROMOTION_THRESHOLD (65) unless it lands on the
 *  character's actual fear axis, so most rupture events log quietly without
 *  becoming permanent world history — that promotion should stay reserved
 *  for the ones desire-engine's own axis-matching already flags as significant. */
async function logImpactIfSignificant(
  userId: string, characterId: string,
  source: 'rupture_repaired' | 'rupture_unresolved',
  title: string, publicSummary: string,
): Promise<void> {
  const baseWeight = source === 'rupture_repaired' ? 40 : 35;
  await recordWorldImpact({
    characterId, userId, source,
    title, description: publicSummary, publicSummary,
    weight: baseWeight,
    characterName: undefined,
  }).catch(() => { /* non-critical, matches world-impact.ts callers elsewhere */ });
  // classifyImpactAxis already runs inside recordWorldImpact itself — no
  // need to fetch core desire here too (previously fetched and discarded).
}

async function clearPending(userId: string, characterId: string, cooldownHours?: number): Promise<void> {
  const update: Database['public']['Tables']['character_psychology']['Update'] = { pending_rupture: null };
  if (cooldownHours) {
    update.rupture_cooldown_until = new Date(Date.now() + cooldownHours * 60 * 60 * 1000).toISOString();
  }
  const { data: updated, error } = await supabaseAdmin
    .from('character_psychology')
    .update(update)
    .eq('user_id', userId)
    .eq('character_id', characterId)
    .select('user_id');

  if (error) throw error;
  if (!updated || updated.length === 0) {
    logger.warn('repair-engine:clear-pending-no-row', { userId, characterId });
  }

  await invalidatePsychologyCache(userId, characterId);
}

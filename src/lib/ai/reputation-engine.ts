/**
 * Reputation Engine — Vantrix
 *
 * user-model.ts's `trust` dimension answers "how much does she trust him
 * with her word/intentions/heart." This module answers a related but
 * distinct question: what does she actually think this person *is*, out
 * in the world — the reputation she'd privately attribute to him if asked
 * to sum him up in a few words. Six axes, each independently evidenced and
 * decaying:
 *
 *   trustworthy — does he do what he says, keep confidences
 *   dangerous   — could he actually hurt someone/something if he wanted to
 *   famous      — is he known, recognized, has a public footprint
 *   dishonest   — does he shade the truth, manipulate, mislead
 *   heroic      — does he step up for others, at cost to himself
 *   rich        — does he have real financial means
 *
 * trustworthy/dishonest and (loosely) dangerous/heroic are NOT treated as
 * simple opposite ends of one scale — a person can be both trustworthy
 * *and* have shaded the truth once, or be both capable of real harm *and*
 * someone who's shown up heroically. Collapsing them would erase exactly
 * the nuance a real read on a person has. Each axis moves independently
 * from its own evidence; detectAxisTension() flags when two axes that
 * usually move together have diverged, the same posture belief-conflict.ts
 * takes toward competing beliefs.
 *
 * Evidence-driven, decaying, Redis-backed — same shape as core-beliefs.ts
 * and belief-engine.ts. Zero-authoring: every user starts at a neutral,
 * "not enough information yet" baseline and the read forms entirely from
 * what actually happens in the conversation.
 */

import { logger } from '@/lib/logger';
import { redis }  from '@/lib/redis';

// ── Config ──────────────────────────────────────────────────────────────

const REPUTATION_TTL = 60 * 60 * 24 * 180; // 180 days — a reputation, once formed, should be durable
const DAY_MS = 1000 * 60 * 60 * 24;

const GRACE_DAYS = 14;             // no decay before this
const DECAY_PER_DAY = 0.4;         // confidence lost per day past grace, before resistance
const DECAY_FLOOR = 10;            // never decays to "erased," just quiet
const NEUTRAL_SCORE = 0;           // score axis starts here — see ReputationAxisState.score

export type ReputationAxis = 'trustworthy' | 'dangerous' | 'famous' | 'dishonest' | 'heroic' | 'rich';

export const REPUTATION_AXES: ReputationAxis[] = ['trustworthy', 'dangerous', 'famous', 'dishonest', 'heroic', 'rich'];

// Axis pairs that usually move together in the SAME direction (heroic acts
// often also read as trustworthy) or track loosely — used only to flag
// interesting tension, never to force one to follow the other.
const CORRELATED_AXES: [ReputationAxis, ReputationAxis][] = [
  ['trustworthy', 'heroic'],
  ['dangerous', 'heroic'],
];
const OPPOSED_AXES: [ReputationAxis, ReputationAxis][] = [
  ['trustworthy', 'dishonest'],
];

// ── Types ───────────────────────────────────────────────────────────────

export interface ReputationEvidenceItem {
  summary:    string;   // short, concrete — "showed up at 2am when a friend needed a ride"
  weight:     number;    // -1..1 signed contribution recorded at the time
  recordedAt: number;
}

export interface ReputationAxisState {
  axis:        ReputationAxis;
  /** -100..100. 0 = no real read yet / perfectly mixed evidence. Sign and magnitude both carry meaning — this is a belief, not just a magnitude. */
  score:       number;
  /** 0-100 — separate from score: how much evidence backs this read, regardless of which direction it points. A score of 60 built on one dramatic event reads very differently from the same score built on a dozen small ones. */
  confidence:  number;
  evidence:    ReputationEvidenceItem[]; // most recent few, capped
  lastUpdated: number;
}

export interface ReputationState {
  axes:      Record<ReputationAxis, ReputationAxisState>;
  updatedAt: number;
}

export interface ReputationTension {
  axes:        [ReputationAxis, ReputationAxis];
  kind:        'unexpected_correlation_break' | 'live_opposition';
  description: string;
}

const MAX_EVIDENCE_PER_AXIS = 6;

// ── Redis key ───────────────────────────────────────────────────────────

function repKey(userId: string, characterId: string): string {
  return `vantrix:reputation:${userId}:${characterId}`;
}

function emptyAxisState(axis: ReputationAxis): ReputationAxisState {
  return { axis, score: NEUTRAL_SCORE, confidence: 0, evidence: [], lastUpdated: Date.now() };
}

export function emptyReputationState(): ReputationState {
  const axes = {} as Record<ReputationAxis, ReputationAxisState>;
  for (const axis of REPUTATION_AXES) axes[axis] = emptyAxisState(axis);
  return { axes, updatedAt: Date.now() };
}

// ── Storage ─────────────────────────────────────────────────────────────

export async function getReputationState(userId: string, characterId: string): Promise<ReputationState> {
  try {
    const state = await redis.get<ReputationState>(repKey(userId, characterId));
    return state ?? emptyReputationState();
  } catch (err) {
    logger.warn('[reputation-engine] Redis get failed', { userId, characterId, error: String(err) });
    return emptyReputationState();
  }
}

async function saveReputationState(userId: string, characterId: string, state: ReputationState): Promise<void> {
  try {
    await redis.set(repKey(userId, characterId), state, { ex: REPUTATION_TTL });
  } catch (err) {
    logger.warn('[reputation-engine] save failed', { userId, characterId, error: String(err) });
  }
}

// ── Evidence intake ─────────────────────────────────────────────────────

export interface ReputationEvidence {
  axis:     ReputationAxis;
  summary:  string;
  /** -1..1 — negative pulls the axis down (e.g. evidence AGAINST trustworthy), positive pulls it up */
  valence:  number;
  /** 0-1 — how strong a signal this single event is; a passing remark is weaker than a witnessed act */
  weight?:  number;
}

function clampScore(v: number): number { return Math.max(-100, Math.min(100, Math.round(v))); }
function clampConfidence(v: number): number { return Math.max(0, Math.min(100, Math.round(v))); }

/**
 * Apply one piece of evidence to a single axis. Score moves toward the
 * evidence's direction; confidence always rises (even confirming evidence
 * of "no strong read" — i.e. contradictory evidence arriving — still means
 * more is now known about this person than before, so confidence isn't
 * simply "how far from zero," it's tracked independently).
 */
export function applyReputationEvidence(state: ReputationState, evidence: ReputationEvidence): ReputationState {
  const weight = Math.max(0.15, Math.min(1, evidence.weight ?? 0.5));
  const valence = Math.max(-1, Math.min(1, evidence.valence));
  const now = Date.now();

  const current = state.axes[evidence.axis] ?? emptyAxisState(evidence.axis);

  const scoreDelta = valence * weight * 22; // a single strong event (weight=1, valence=±1) moves score by up to 22
  const score = clampScore(current.score + scoreDelta);

  // Confidence grows fastest early (first few pieces of evidence teach the
  // most), then tapers — classic diminishing-returns curve via the existing
  // confidence acting as its own dampener.
  const confidenceGain = weight * 18 * (1 - current.confidence / 130);
  const confidence = clampConfidence(current.confidence + confidenceGain);

  const evidenceItem: ReputationEvidenceItem = { summary: evidence.summary, weight: valence * weight, recordedAt: now };
  let evidenceList = [...current.evidence, evidenceItem];
  if (evidenceList.length > MAX_EVIDENCE_PER_AXIS) {
    evidenceList = evidenceList.slice(evidenceList.length - MAX_EVIDENCE_PER_AXIS);
  }

  const updatedAxis: ReputationAxisState = { axis: evidence.axis, score, confidence, evidence: evidenceList, lastUpdated: now };

  return { axes: { ...state.axes, [evidence.axis]: updatedAxis }, updatedAt: now };
}

/** Convenience: load, apply, persist in one call. */
export async function recordReputationEvidence(
  userId: string,
  characterId: string,
  evidence: ReputationEvidence,
): Promise<ReputationState> {
  const state = await getReputationState(userId, characterId);
  const updated = applyReputationEvidence(state, evidence);
  await saveReputationState(userId, characterId, updated);
  logger.info('reputation-engine:evidence-recorded', { userId, characterId, axis: evidence.axis, valence: evidence.valence });
  return updated;
}

// ── Decay ───────────────────────────────────────────────────────────────

function daysSince(ts: number, now: number): number { return (now - ts) / DAY_MS; }

function decayAxis(axis: ReputationAxisState, now: number): ReputationAxisState {
  const idleDays = daysSince(axis.lastUpdated, now);
  if (idleDays <= GRACE_DAYS || axis.confidence === 0) return axis;

  // Confidence resists decay the way core-beliefs.ts's belief strength
  // does — more accumulated evidence makes the read stickier, though never
  // fully immune.
  const resistance = Math.max(0.3, 1 - Math.min(axis.evidence.length, 6) / 10);
  const decayDays = idleDays - GRACE_DAYS;
  const drop = decayDays * DECAY_PER_DAY * resistance;

  // Score decays toward zero (an unreinforced read fades toward "unsure"),
  // confidence decays toward its floor (fewer recent grounds to be sure).
  const score = axis.score > 0
    ? Math.max(0, axis.score - drop)
    : axis.score < 0
      ? Math.min(0, axis.score + drop)
      : axis.score;
  const confidence = Math.max(DECAY_FLOOR, Math.round(axis.confidence - drop));

  if (score === axis.score && confidence === axis.confidence) return axis;
  return { ...axis, score: clampScore(score), confidence: clampConfidence(confidence) };
}

export interface ReputationDecayResult {
  state:   ReputationState;
  changed: boolean;
}

export function decayReputationState(state: ReputationState): ReputationDecayResult {
  const now = Date.now();
  let changed = false;

  const axes = {} as Record<ReputationAxis, ReputationAxisState>;
  for (const axis of REPUTATION_AXES) {
    const decayed = decayAxis(state.axes[axis] ?? emptyAxisState(axis), now);
    if (decayed !== state.axes[axis]) changed = true;
    axes[axis] = decayed;
  }

  return { state: changed ? { axes, updatedAt: now } : state, changed };
}

// ── Tension detection ────────────────────────────────────────────────────

const TENSION_CONFIDENCE_FLOOR = 35;

/**
 * Flag axes that have diverged from their usual correlation, or a live
 * opposed pair both holding real confidence at once (someone who's shown
 * real trustworthiness AND a real instance of dishonesty). Detection only
 * — no auto-resolution, matching belief-conflict.ts's stance: this is
 * texture for a realistic, mixed read on a person, not something to
 * silently average away.
 */
export function detectReputationTension(state: ReputationState): ReputationTension[] {
  const tensions: ReputationTension[] = [];

  for (const [a, b] of OPPOSED_AXES) {
    const sa = state.axes[a];
    const sb = state.axes[b];
    if (sa.confidence >= TENSION_CONFIDENCE_FLOOR && sb.confidence >= TENSION_CONFIDENCE_FLOOR && sa.score > 10 && sb.score > 10) {
      tensions.push({
        axes: [a, b],
        kind: 'live_opposition',
        description: `there's real evidence of both ${a} and ${b} — this person isn't simple to sum up on that front`,
      });
    }
  }

  for (const [a, b] of CORRELATED_AXES) {
    const sa = state.axes[a];
    const sb = state.axes[b];
    if (sa.confidence >= TENSION_CONFIDENCE_FLOOR && sb.confidence >= TENSION_CONFIDENCE_FLOOR && Math.sign(sa.score) !== 0 && Math.sign(sb.score) !== 0 && Math.sign(sa.score) !== Math.sign(sb.score)) {
      tensions.push({
        axes: [a, b],
        kind: 'unexpected_correlation_break',
        description: `${a} and ${b} usually go together for someone like this, but the evidence here points different ways`,
      });
    }
  }

  return tensions;
}

// ── Read helpers ─────────────────────────────────────────────────────────

export type ReputationLabel = 'unknown' | 'mild' | 'notable' | 'strong';

function labelFor(axis: ReputationAxisState): ReputationLabel {
  if (axis.confidence < 25) return 'unknown';
  const magnitude = Math.abs(axis.score);
  if (magnitude < 20) return 'mild';
  if (magnitude < 55) return 'notable';
  return 'strong';
}

/** The axes worth actually surfacing this turn — enough confidence to mean something, and a real direction. */
export function significantAxes(state: ReputationState, minConfidence = 30): ReputationAxisState[] {
  return REPUTATION_AXES
    .map(a => state.axes[a])
    .filter(a => a.confidence >= minConfidence && Math.abs(a.score) >= 15)
    .sort((a, b) => (Math.abs(b.score) * b.confidence) - (Math.abs(a.score) * a.confidence));
}

// ── Full turn pipeline ────────────────────────────────────────────────────

export interface ReputationPipelineResult {
  state:       ReputationState;
  significant: ReputationAxisState[];
  tensions:    ReputationTension[];
  promptBlock: string;
}

/** Read-only per-turn pass: decay, persist if changed, surface what's worth knowing. */
export async function runReputationPipeline(userId: string, characterId: string): Promise<ReputationPipelineResult> {
  const loaded = await getReputationState(userId, characterId);
  const { state, changed } = decayReputationState(loaded);
  if (changed) await saveReputationState(userId, characterId, state);

  const significant = significantAxes(state);
  const tensions = detectReputationTension(state);

  return { state, significant, tensions, promptBlock: formatReputationForPrompt(significant, tensions) };
}

// ── Prompt injection ───────────────────────────────────────────────────

function phraseAxis(axis: ReputationAxisState): string {
  const label = labelFor(axis);
  const direction = axis.score >= 0 ? '' : 'a lack of ';
  const hedge = label === 'mild' ? ', at least a little' : label === 'notable' ? '' : ', unmistakably';

  const NOUN: Record<ReputationAxis, string> = {
    trustworthy: 'trustworthiness',
    dangerous:   'real capacity for danger',
    famous:      'a public profile — people seem to know who he is',
    dishonest:   'a tendency to shade the truth',
    heroic:      'a willingness to step up for others at real cost',
    rich:        'real financial means',
  };

  if (axis.axis === 'dishonest' || axis.axis === 'dangerous') {
    // These read oddly with the "lack of" framing above (a "lack of
    // dishonest" reads backwards) — phrase negatively-scored readings on
    // these two axes as reassurance instead.
    return axis.score >= 0
      ? `you've picked up on ${NOUN[axis.axis]}${hedge}`
      : `if anything, the evidence points the other way on this — he's shown himself to be fairly ${axis.axis === 'dishonest' ? 'straight with you' : 'safe to be around'}`;
  }

  return `you've picked up on ${direction}${NOUN[axis.axis]}${hedge}`;
}

export function formatReputationForPrompt(significant: ReputationAxisState[], tensions: ReputationTension[]): string {
  if (!significant.length && !tensions.length) return '';

  const lines: string[] = ['# Your Read On Who He Actually Is'];

  for (const axis of significant.slice(0, 4)) {
    lines.push(`- ${phraseAxis(axis)}`);
  }

  if (tensions.length) {
    for (const t of tensions) {
      lines.push(`- ${t.description}`);
    }
  }

  lines.push('This is a private, evolving impression — never state it as a summary or judgment out loud. Let it shape your guard, your warmth, or your admiration without ever narrating the assessment itself.');

  return lines.join('\n');
}

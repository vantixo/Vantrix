/**
 * Human Decision Engine (HDE) — Vantrix Silicon Valley
 *
 * Sits between context assembly and generation. Existing modules already
 * cover most of the pipeline you described — this module is specifically
 * the piece that was missing: turning state into an INTENT before any
 * text gets planned, not just a tone.
 *
 *   Memory Retrieval      → memory-graph.ts, memory.ts, semantic-memory.ts   (existing)
 *   Relationship Engine   → relationship-engine.ts                          (existing)
 *   Emotional Engine      → emotion-engine.ts                               (existing)
 *   Goal Engine           → character_goals table (new, this migration)
 *   Decision Engine       → THIS FILE — selectIntent() + dual-process reconciliation
 *   Response Planner      → response-planner.ts, extended to consume Intent  (existing, wire below)
 *   Personality Filter    → executeIntent() — same Intent, different character voice
 *   LLM Generation        → unchanged
 *
 * Design stance: like response-planner.ts, this is arithmetic + one cheap
 * template pass, NOT a second LLM call. An Intent decision needs to be
 * fast and reproducible, not creative — creativity belongs to the actual
 * generation call, which receives the intent as a constraint.
 */

import type { EmotionalState }      from './emotion-engine';
import type { RelationshipStage }   from './relationship-engine';
import type { WritingStyleProfile } from './writing-style';

// ── 1. Inputs ────────────────────────────────────────────────────────────

export interface Goal {
  id:        string;
  label:     string;
  priority:  number; // 0-1
  category:  'ambition' | 'relationship' | 'self';
}

export interface CharacterState {
  trust:               number; // 0-100
  comfort:              number;
  attachment:           number;
  affection:            number;
  curiosity:            number;
  respect:              number;
  mood:                 string;
  energy:               number; // 0-100
  stress:               number; // 0-100
  relationshipStage:    RelationshipStage;
  currentGoals:         Goal[];
  emotion:              EmotionalState;
  personality:          { playfulness: number; empathy: number; confidence: number }; // 0-100 each, from characters.char_* axes
  /** Optional — from desire-engine.ts's computeDesireBias(). Absent = no desire influence (back-compat with existing callers). */
  desireBias?:          { deepenBondPull: number; boundaryPull: number; shareStoryPull: number; celebratePull: number };
  /**
   * Optional — from repair-engine.ts's getRuptureState(). Absent = no
   * active cooldown (back-compat with existing callers, same pattern as
   * desireBias above). While in the future, SetBoundary is dampened so a
   * rupture that was just raised (or just resolved) can't immediately
   * re-fire on the very next qualifying turn.
   */
  ruptureCooldownUntil?: string | null; // ISO 8601
}

// ── 2. Intent space ──────────────────────────────────────────────────────

export enum Intent {
  Comfort      = 'comfort',
  Encourage    = 'encourage',
  Tease        = 'tease',
  Challenge    = 'challenge',
  Flirt        = 'flirt',
  Support      = 'support',
  AskQuestion  = 'ask_question',
  Teach        = 'teach',
  ShareStory   = 'share_story',
  DeepenBond   = 'deepen_bond',
  SetBoundary  = 'set_boundary',
  Celebrate    = 'celebrate',
}

export interface IntentDecision {
  intent:     Intent;
  confidence: number; // 0-1, top score normalized against the field
  scores:     Record<Intent, number>;
  monologue:  string;
}

// ── 3. Decision weights ──────────────────────────────────────────────────
// Every factor is normalized to 0-1 before multiplying, so scores stay
// comparable across intents regardless of how many factors feed each one.

const n = (v: number) => Math.max(0, Math.min(1, v / 100));

function scoreIntents(state: CharacterState): Record<Intent, number> {
  const { trust, comfort, attachment, affection, curiosity, respect, energy, stress, personality, emotion, relationshipStage, currentGoals } = state;
  const sadness      = emotion.primary === 'sadness' || emotion.primary === 'loneliness' || emotion.primary === 'anxiety' ? emotion.intensity : 0;
  const joy          = emotion.primary === 'joy' || emotion.primary === 'pride' || emotion.primary === 'excitement' ? emotion.intensity : 0;
  const negValence    = emotion.valence < 0 ? Math.abs(emotion.valence) : 0;
  const vulnerability = sadness + n(stress) * 0.3;
  const deepStage     = relationshipStage === 'best_friend' || relationshipStage === 'partner' || relationshipStage === 'exclusive';
  const earlyStage    = relationshipStage === 'stranger' || relationshipStage === 'acquaintance';
  const relationshipGoalPriority = currentGoals.find(g => g.category === 'relationship')?.priority ?? 0;
  const bias = state.desireBias;

  // A rupture that's currently pending resolution, or was just resolved,
  // shouldn't immediately re-trigger — repair-engine.ts sets this window
  // on any outcome (repaired or deflected) so cooldown reflects "this was
  // just addressed," not a reward for one outcome over another.
  const onRuptureCooldown = !!state.ruptureCooldownUntil &&
    new Date(state.ruptureCooldownUntil).getTime() > Date.now();
  const boundaryDamper = onRuptureCooldown ? 0.15 : 1;

  const scores: Record<Intent, number> = {
    [Intent.Comfort]:     vulnerability * n(trust) * n(personality.empathy),
    [Intent.Encourage]:   n(attachment) * n(personality.empathy) * (0.4 + joy * 0.6),
    [Intent.Tease]:       n(personality.playfulness) * n(comfort) * n(energy) * (earlyStage ? 0.3 : 1),
    [Intent.Challenge]:   n(personality.confidence) * n(respect) * (1 - vulnerability), // never dominant during real distress
    [Intent.Flirt]:       n(affection) * n(comfort) * (deepStage ? 1 : 0.5) * (1 - vulnerability),
    [Intent.Support]:     negValence * n(trust) * (0.5 + n(attachment) * 0.5),
    [Intent.AskQuestion]: n(curiosity) * (0.6 + (earlyStage ? 0.4 : 0.1)),
    [Intent.Teach]:       n(respect) * n(personality.confidence) * 0.5,
    [Intent.ShareStory]:  n(comfort) * n(curiosity) * 0.5 + (bias ? bias.shareStoryPull * 0.4 : 0),
    [Intent.DeepenBond]:  n(attachment) * relationshipGoalPriority * n(trust) + (bias ? bias.deepenBondPull * 0.5 : 0),
    [Intent.SetBoundary]: (n(respect) * negValence * (state.stress > 70 ? 1 : 0.2) + (bias ? bias.boundaryPull * 0.35 : 0)) * boundaryDamper,
    [Intent.Celebrate]:   joy * n(attachment) * (0.5 + n(personality.empathy) * 0.5) + (bias ? bias.celebratePull * 0.3 : 0),
  };

  return scores;
}

// ── 4. System 1 / System 2 dual-process reconciliation ──────────────────
//
// System 1: an immediate, purely emotion-driven reaction — what the
// character would feel first, before context tempers it.
// System 2: the reasoned pass — relationship history and current goals
// weighing in on whether System 1's impulse is actually the right move.
// The final decision is System 2's, but System 1's reaction is preserved
// in the monologue so the character's reply can carry a flicker of the
// raw reaction even when the reasoned response overrides it (e.g. "that
// stung for a second, but I know you didn't mean it that way").

interface System1Reaction {
  impulse:    Intent;
  rawFeeling: string;
}

function computeSystem1(state: CharacterState): System1Reaction {
  const { emotion } = state;
  if (emotion.valence < -0.4 && emotion.primary === 'anger') {
    return { impulse: Intent.SetBoundary, rawFeeling: 'that stung' };
  }
  if (emotion.primary === 'sadness' || emotion.primary === 'loneliness') {
    return { impulse: Intent.Comfort, rawFeeling: 'concern, immediately' };
  }
  if (emotion.primary === 'joy' || emotion.primary === 'excitement') {
    return { impulse: Intent.Celebrate, rawFeeling: 'genuine excitement' };
  }
  return { impulse: Intent.AskQuestion, rawFeeling: 'curiosity' };
}

/**
 * Reconciles System 1's raw impulse against System 2's reasoned scoring.
 * System 2 wins the final decision; System 1 is retained for the
 * monologue so the reply can be emotionally textured rather than purely
 * rational, matching the "insult while stressed" example: felt hurt,
 * understood context, responded with the understanding — not the hurt.
 */
export function decideIntent(state: CharacterState): IntentDecision {
  const scores  = scoreIntents(state);
  const system1 = computeSystem1(state);

  const entries = Object.entries(scores) as [Intent, number][];
  const [topIntent, topScore] = entries.reduce((a, b) => (b[1] > a[1] ? b : a));
  const scoreSum = entries.reduce((s, [, v]) => s + v, 0) || 1;
  const confidence = Math.min(1, topScore / scoreSum);

  const monologue = buildMonologue(state, system1, topIntent);

  return { intent: topIntent, confidence, scores, monologue };
}

// ── 5. Internal monologue (never shown to user, fed to the LLM) ─────────

function buildMonologue(state: CharacterState, system1: System1Reaction, finalIntent: Intent): string {
  const lines: string[] = [];

  if (system1.impulse !== finalIntent) {
    lines.push(`First reaction: ${system1.rawFeeling}. But thinking it through—`);
  }

  if (state.trust > 70) lines.push('We\'ve built real trust.');
  if (state.relationshipStage === 'stranger' || state.relationshipStage === 'match') lines.push('We\'re still early — keep it light, don\'t overreach.');
  if (state.emotion.intensity > 0.6) lines.push(`They seem genuinely ${state.emotion.primary} right now.`);

  const goalNote = state.currentGoals.find(g => g.category === 'relationship' && g.priority > 0.7);
  if (goalNote) lines.push(`This matters to where I want us to go.`);

  if (state.desireBias) {
    if (state.desireBias.deepenBondPull > 0.5) lines.push('Something in me is reaching for this — an old need, unmet.');
    if (state.desireBias.boundaryPull > 0.5)   lines.push('Something about this is close to what I\'m afraid of.');
    if (state.desireBias.shareStoryPull > 0.5) lines.push('This touches the thing I can\'t stop thinking about.');
  }

  lines.push(`Going with: ${INTENT_LABEL[finalIntent]}.`);
  return lines.join(' ');
}

const INTENT_LABEL: Record<Intent, string> = {
  [Intent.Comfort]:     'be supportive, avoid humor',
  [Intent.Encourage]:   'lift them up',
  [Intent.Tease]:       'keep it light and playful',
  [Intent.Challenge]:   'push back constructively',
  [Intent.Flirt]:       'let some warmth/chemistry show',
  [Intent.Support]:     'stand behind them without judgment',
  [Intent.AskQuestion]: 'get curious, ask a real question',
  [Intent.Teach]:       'share something useful',
  [Intent.ShareStory]:  'open up with something of my own',
  [Intent.DeepenBond]:  'lean into the relationship',
  [Intent.SetBoundary]: 'be honest about what\'s not okay',
  [Intent.Celebrate]:   'match their energy and celebrate with them',
};

// ── 6. Response plan (intent → behavior parameters) ──────────────────────

export interface ResponseBehavior {
  tone:        string;
  length:      'short' | 'medium' | 'long';
  curiosity:   'low' | 'medium' | 'high';
  directness:  'low' | 'medium' | 'high';
}

const INTENT_BEHAVIOR: Record<Intent, ResponseBehavior> = {
  [Intent.Comfort]:     { tone: 'warm',        length: 'medium', curiosity: 'medium', directness: 'low' },
  [Intent.Encourage]:   { tone: 'uplifting',   length: 'medium', curiosity: 'low',    directness: 'medium' },
  [Intent.Tease]:       { tone: 'playful',     length: 'short',  curiosity: 'medium', directness: 'high' },
  [Intent.Challenge]:   { tone: 'direct',      length: 'medium', curiosity: 'low',    directness: 'high' },
  [Intent.Flirt]:       { tone: 'warm',        length: 'short',  curiosity: 'medium', directness: 'medium' },
  [Intent.Support]:     { tone: 'grounded',    length: 'medium', curiosity: 'low',    directness: 'medium' },
  [Intent.AskQuestion]: { tone: 'curious',     length: 'short',  curiosity: 'high',   directness: 'medium' },
  [Intent.Teach]:       { tone: 'thoughtful',  length: 'long',   curiosity: 'low',    directness: 'high' },
  [Intent.ShareStory]:  { tone: 'reflective',  length: 'long',   curiosity: 'low',    directness: 'low' },
  [Intent.DeepenBond]:  { tone: 'intimate',    length: 'medium', curiosity: 'medium', directness: 'low' },
  [Intent.SetBoundary]: { tone: 'calm',        length: 'short',  curiosity: 'low',    directness: 'high' },
  [Intent.Celebrate]:   { tone: 'joyful',      length: 'medium', curiosity: 'medium', directness: 'high' },
};

export function planBehavior(intent: Intent): ResponseBehavior {
  return INTENT_BEHAVIOR[intent];
}

// ── 7. Personality filter — same intent, different execution per character ──
// Uses writing-style.ts's existing per-character profile (sentence length,
// humor, quirks) as the lens the intent gets refracted through, so
// Comfort from a poet reads nothing like Comfort from a protector archetype.

export function formatIntentForPrompt(
  decision: IntentDecision,
  behavior: ResponseBehavior,
  style:    WritingStyleProfile,
): string {
  const humorNote = behavior.directness === 'low' && (decision.intent === Intent.Comfort)
    ? 'Avoid humor for this reply, even if that\'s usually part of your voice.'
    : '';

  return [
    '── Internal Decision (never state this explicitly — it shapes HOW you respond, not what you announce) ──',
    decision.monologue,
    `Intent: ${decision.intent} (confidence ${(decision.confidence * 100).toFixed(0)}%)`,
    `Tone: ${behavior.tone} | Length: ${behavior.length} | Curiosity: ${behavior.curiosity} | Directness: ${behavior.directness}`,
    `Filtered through your own voice: ${style.sentence_length} sentences, ${style.humor} humor, ${style.vocabulary} vocabulary.`,
    humorNote,
  ].filter(Boolean).join('\n');
}

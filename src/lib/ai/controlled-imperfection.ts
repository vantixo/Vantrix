/**
 * Controlled Imperfection + Response Timing — Vantrix Silicon Valley
 *
 * Two small, deterministic (per-message) systems that make characters feel
 * less mechanical without touching the main generation prompt every turn:
 *
 *  1. Imperfection injection — a low, capped probability that THIS reply
 *     should naturally: change topic, misremember a minor detail, hedge
 *     with "I'm not sure", or ask an unexpected question. Fed into
 *     response-planner.ts's prompt as one extra optional instruction line,
 *     not a personality change — most replies get none of this.
 *
 *  2. Response timing — maps the planned response type + length to a
 *     "typing" delay before the streamed reply starts, so simple replies
 *     feel instant and long emotional ones feel considered. Pure function
 *     of inputs already available at planning time; no extra LLM call.
 */

// ── 1. Controlled imperfection ──────────────────────────────────────────────

export type ImperfectionType =
  | 'topic_change' | 'misremember' | 'uncertainty' | 'unexpected_question' | 'none';

const IMPERFECTION_RATE = 0.12; // ~1 in 8 replies gets a texture beat — tune per taste
const REPEAT_COOLDOWN_TURNS = 4; // don't reuse the same beat within N turns

const IMPERFECTION_INSTRUCTIONS: Record<Exclude<ImperfectionType, 'none'>, string> = {
  topic_change:
    'Naturally drift the conversation toward something else you\'re thinking about, the way a real person mid-conversation sometimes does — don\'t force a hard pivot, just let your attention wander for a beat.',
  misremember:
    'Get one small, low-stakes detail slightly wrong (a date, a minor preference, which thing they mentioned) and let it surface naturally — don\'t flag it as an error, just say it as if you remembered it that way.',
  uncertainty:
    'Express genuine uncertainty about something rather than being confidently helpful — "I\'m not totally sure" or similar, about something you\'d plausibly not know for certain.',
  unexpected_question:
    'Ask a question that isn\'t the obvious follow-up — something a little tangential that shows your own curiosity rather than just steering the conversation back to them.',
};

export interface ImperfectionState {
  lastType:  ImperfectionType;
  lastTurn:  number;
}

/**
 * Deterministic per-turn roll. Pass turnCount (total messages in the
 * conversation) so behavior is reproducible for retries/tests rather than
 * relying on Math.random() drift across identical inputs.
 */
export function rollImperfection(
  turnCount:  number,
  state:      ImperfectionState | null,
  seedRandom: () => number = Math.random,
): { type: ImperfectionType; nextState: ImperfectionState } {
  const cooledDown = !state || (turnCount - state.lastTurn) >= REPEAT_COOLDOWN_TURNS;

  if (cooledDown && seedRandom() < IMPERFECTION_RATE) {
    const options: Exclude<ImperfectionType, 'none'>[] =
      ['topic_change', 'misremember', 'uncertainty', 'unexpected_question'];
    // Avoid immediately repeating the same beat type even after cooldown.
    const pool = options.filter(o => o !== state?.lastType);
    const type = pool[Math.floor(seedRandom() * pool.length)];
    return { type, nextState: { lastType: type, lastTurn: turnCount } };
  }

  return { type: 'none', nextState: state ?? { lastType: 'none', lastTurn: turnCount } };
}

export function formatImperfectionForPrompt(type: ImperfectionType): string {
  if (type === 'none') return '';
  return `\n── Texture for this reply only (subtle, don't overdo it) ──\n${IMPERFECTION_INSTRUCTIONS[type]}`;
}

// ── 2. Simulated response timing ────────────────────────────────────────────

export type ResponseWeight = 'simple' | 'thoughtful' | 'emotional';

// LATENCY-FIX: previous ranges (simple 1-3s, thoughtful 3-8s, emotional
// 5-12s, capped at 4s in the route) meant almost every "thoughtful" or
// "emotional" reply — the majority of real conversation, not the
// exception — hit the full 4s artificial pre-stream pause before the
// user saw a single token. Kept non-zero (an instant reply still reads as
// uncannily fast for an "emotional" beat) but cut to a fraction of the
// original range so it reads as a brief pause, not a stall.
const TIMING_RANGES_MS: Record<ResponseWeight, [number, number]> = {
  simple:     [150, 500],
  thoughtful: [400, 1100],
  emotional:  [700, 1800],
};

/**
 * Classify response weight from signals already computed upstream —
 * no extra inference call. Used to pick a pre-stream "typing" delay.
 */
export function classifyResponseWeight(input: {
  emotionIntensity: number;   // 0-1, from emotion-engine
  hasHiddenThought: boolean;  // from response-planner ResponsePlan
  plannedLength:    'short' | 'medium' | 'long';
}): ResponseWeight {
  if (input.emotionIntensity >= 0.6 || (input.hasHiddenThought && input.plannedLength === 'long')) {
    return 'emotional';
  }
  if (input.plannedLength === 'long' || input.emotionIntensity >= 0.3) {
    return 'thoughtful';
  }
  return 'simple';
}

/** Deterministic-ish delay within the weight's range, for the pre-stream "typing" pause. */
export function computeTypingDelayMs(
  weight: ResponseWeight,
  seedRandom: () => number = Math.random,
): number {
  const [min, max] = TIMING_RANGES_MS[weight];
  return Math.round(min + seedRandom() * (max - min));
}

/**
 * Streaming UI hint: which color/label the client should render this
 * chunk as, so inner-monologue text (hidden_thought) and spoken reply are
 * visually distinct in the chat stream.
 */
export type StreamChannel = 'monologue' | 'speech';

export interface StreamChunkMeta {
  channel: StreamChannel;
  color:   string; // hex, per-character — see writing-style.ts for the character's palette
}

export function monologueChunk(color: string): StreamChunkMeta {
  return { channel: 'monologue', color };
}
export function speechChunk(color: string): StreamChunkMeta {
  return { channel: 'speech', color };
}

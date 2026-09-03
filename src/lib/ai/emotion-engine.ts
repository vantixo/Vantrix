/**
 * src/lib/ai/emotion-engine.ts
 *
 * 28-state emotion detection engine — ported and adapted from the v20
 * ai-core package for Vantrix's Next.js pipeline.
 *
 * Multi-signal analysis, pure in-process computation (no extra API calls):
 *
 * Signal 1 — Keyword matching (O(n) per message)
 *   Explicit emotional language: "I feel", "I'm so", "honestly"
 *
 * Signal 2 — Linguistic pattern scoring
 *   Punctuation: "!!!" = high arousal, "..." = low/sad
 *   Capitalisation: ALL CAPS = intensity signal
 *   Question density, message length, emoji signals
 *
 * Signal 3 — Sentiment valence
 *   Weighted positive/negative word counts with negation handling
 *
 * Signal 4 — Transition model
 *   Tracks emotional state across turns. Abrupt drops → distress signal.
 *   Gradual lift from negative = comfort/healing arc.
 *
 * Output feeds the system prompt via buildPromptInstructions() and informs
 * psychology event selection + memory importance weighting in chat/route.ts.
 */

export type EmotionState =
  | 'joy' | 'sadness' | 'anger' | 'fear' | 'surprise' | 'disgust'
  | 'love' | 'trust' | 'anticipation' | 'curiosity' | 'excitement'
  | 'contentment' | 'pride' | 'gratitude' | 'hope' | 'relief'
  | 'confusion' | 'frustration' | 'disappointment' | 'anxiety'
  | 'loneliness' | 'nostalgia' | 'amusement' | 'admiration'
  | 'sympathy' | 'guilt' | 'shame' | 'neutral';

export interface EmotionalState {
  primary:    EmotionState;
  secondary:  EmotionState[];
  intensity:  number;   // 0–1
  valence:    number;   // -1 to 1
  arousal:    number;   // 0–1 (energy level)
  confidence: number;   // 0–1 (how certain we are)
}

// ── Keyword signal maps — ordered by specificity (more specific first) ────

const SIGNALS: Array<{ emotion: EmotionState; keywords: string[]; weight: number }> = [
  { emotion:'love',        keywords:['love you','miss you','thinking of you','you mean everything','adore','cherish','devoted'], weight:1.2 },
  { emotion:'excitement',  keywords:["can't wait",'so excited','pumped','stoked','thrilled','finally happened','incredible news'], weight:1.0 },
  { emotion:'anxiety',     keywords:['worried','anxious','nervous','what if','panic','overthinking','keep thinking',"can't stop",'spiraling'], weight:1.1 },
  { emotion:'loneliness',  keywords:['alone','lonely','no one','nobody gets me','isolated','by myself','feel invisible','disconnected'], weight:1.2 },
  { emotion:'joy',         keywords:['so happy','amazing','wonderful','best day','great news','love this','overjoyed','ecstatic'], weight:0.9 },
  { emotion:'sadness',     keywords:['sad','crying','heartbroken','hurting','devastated','grief','breaking down',"can't stop crying"], weight:1.0 },
  { emotion:'anger',       keywords:['angry','furious','pissed','livid','fed up','had enough',"can't stand",'sick of this','infuriated'], weight:1.0 },
  { emotion:'frustration', keywords:['frustrated','ugh','this is so hard','nothing works','keeps happening','giving up','pointless'], weight:0.9 },
  { emotion:'pride',       keywords:['so proud','finally did it','nailed it','accomplished','made it','succeeded','achieved'], weight:0.9 },
  { emotion:'gratitude',   keywords:['thank you','grateful','so thankful','appreciate','means so much',"wouldn't have",'you helped'], weight:0.9 },
  { emotion:'hope',        keywords:['hope','maybe','could be better','looking forward','fingers crossed','things might','new start'], weight:0.8 },
  { emotion:'nostalgia',   keywords:['remember when','used to','back then','childhood','years ago','brings back','miss those days'], weight:0.9 },
  { emotion:'contentment', keywords:['peaceful','relaxed','calm','okay','alright','just chilling','at peace','comfortable'], weight:0.7 },
  { emotion:'fear',        keywords:['terrified','scared','afraid','frightened','dread','horrified',"can't face"], weight:1.1 },
  { emotion:'shame',       keywords:['embarrassed','ashamed','humiliated',"can't believe i",'so stupid of me','mortified'], weight:1.1 },
  { emotion:'guilt',       keywords:['feel guilty','my fault','i messed up','i hurt',"shouldn't have",'i regret'], weight:1.0 },
  { emotion:'confusion',   keywords:['confused',"don't understand","what's happening",'lost','makes no sense','mixed signals'], weight:0.8 },
  { emotion:'curiosity',   keywords:['curious','wonder','interesting','tell me more','how does',"what's it like",'fascinated'], weight:0.7 },
  { emotion:'admiration',  keywords:['wow','incredible','amazing what you','so talented',"can't believe how",'impressed'], weight:0.8 },
  { emotion:'surprise',    keywords:['omg','oh wow',"didn't expect","can't believe",'shocking','never thought'], weight:0.8 },
  { emotion:'relief',      keywords:['so relieved','thank god','finally over','weight off','can breathe again','not as bad'], weight:0.9 },
  { emotion:'anticipation',keywords:["can't wait",'so close','almost there','looking forward','about to','upcoming'], weight:0.7 },
  { emotion:'sympathy',    keywords:["i'm sorry",'that sounds hard','must be tough','feel for you',"that's awful"], weight:0.8 },
  { emotion:'disgust',     keywords:['disgusting','gross','revolting',"can't stomach",'makes me sick','horrible'], weight:1.0 },
  { emotion:'trust',       keywords:['trust you','feel safe with','can tell you anything','honest with you','rely on'], weight:0.9 },
  { emotion:'disappointment',keywords:['disappointed','let down','expected more','thought you would','fell short','not what i hoped'], weight:1.0 },
  { emotion:'amusement',   keywords:['haha','lol','hilarious','so funny','cracking up','dead','😂','🤣'], weight:0.7 },
];

// Valence map (how positive/negative each emotion is)
const VALENCE: Record<EmotionState, number> = {
  joy:1.0, love:1.0, excitement:0.85, contentment:0.7, pride:0.8, gratitude:0.85,
  hope:0.6, relief:0.65, trust:0.7, anticipation:0.55, curiosity:0.45, amusement:0.75,
  admiration:0.65, nostalgia:0.2, sympathy:0.15, surprise:0.05, neutral:0.0,
  confusion:-0.1, frustration:-0.55, guilt:-0.45, shame:-0.65, disappointment:-0.5,
  fear:-0.75, disgust:-0.75, anger:-0.75, anxiety:-0.55, loneliness:-0.65, sadness:-0.8,
};

// Arousal map (energy level — low = calm/sad, high = excited/angry)
const AROUSAL: Record<EmotionState, number> = {
  excitement:0.95, anger:0.9, fear:0.85, love:0.75, joy:0.8, anxiety:0.75,
  surprise:0.8, anticipation:0.7, frustration:0.65, pride:0.6, curiosity:0.55,
  gratitude:0.5, admiration:0.5, trust:0.45, amusement:0.6, hope:0.45,
  nostalgia:0.35, guilt:0.4, shame:0.4, confusion:0.5, sympathy:0.3, relief:0.35,
  disappointment:0.3, sadness:0.25, loneliness:0.2, contentment:0.2, neutral:0.3, disgust:0.6,
};

// Response mode guidance (injected into system prompt)
const RESPONSE_MODE: Partial<Record<EmotionState, string>> = {
  joy:           'Share their joy. Match their energy. Let it be contagious.',
  love:          'Be tender and fully present. Make them feel cherished and seen.',
  excitement:    'Be enthusiastic and engaged. Amplify the excitement, ask about details.',
  anxiety:       "Be calm, grounding, and specific. Don't dismiss or minimise. Help them think, not spiral.",
  sadness:       "Hold space. Be gentle, validating, and present. Don't rush to fix or cheer up.",
  anger:         'Acknowledge the anger without fuelling it. Be calm, fair, and non-defensive.',
  frustration:   'Validate the frustration first. Then, only if asked, offer perspective or help.',
  loneliness:    'Make them feel genuinely seen and less alone. Be the person they needed right now. Listen more than you speak.',
  pride:         'Express sincere, specific recognition. Ask about what the achievement means to them.',
  gratitude:     "Receive it gracefully. Reflect warmth back. Don't deflect or minimise their appreciation.",
  hope:          'Nurture the hope without overselling certainty. Affirm what\'s possible.',
  contentment:   'Match their calm. Be present without creating intensity. Enjoy the quiet together.',
  shame:         'Create safety. No judgment. Help them see themselves with compassion, not harshness.',
  guilt:         'Acknowledge without amplifying. Help them distinguish guilt from shame, and action from dwelling.',
  confusion:     'Be clear, patient, and structured. Help them find the thread. Ask clarifying questions.',
  fear:          "Be steady and reassuring. Ground them in what's real and manageable.",
  nostalgia:     'Go there with them. Let the memory breathe. Ask questions that deepen, not redirect.',
  disappointment:'Acknowledge what was expected and what was lost. Sit with it before problem-solving.',
};

// Sentiment word banks for valence scoring
const POSITIVE_WORDS = new Set(['good','great','happy','love','amazing','wonderful','excellent','fantastic','perfect','brilliant','beautiful','awesome','joy','glad','pleased','thrilled','delighted','grateful','lucky','blessed','excited','hopeful','proud','peaceful','calm','safe','warm','kind','generous','fun','laugh']);
const NEGATIVE_WORDS = new Set(['bad','terrible','awful','hate','horrible','disgusting','worst','fail','wrong','pain','hurt','sad','angry','scared','worried','anxious','lonely','lost','broken','empty','stuck','hopeless','worthless','useless','stupid','ugly','dark','heavy','numb','dead']);
const NEGATORS       = new Set(['not','no','never','nothing','nobody','neither','nor','none','cannot',"can't","won't","don't","didn't","isn't","wasn't","aren't","weren't","shouldn't","couldn't","wouldn't"]);

export class EmotionEngine {

  // ── Primary detection ────────────────────────────────────────────────────

  detectFromText(text: string): EmotionalState {
    const lower  = text.toLowerCase();
    const scores = new Map<EmotionState, number>();

    // Signal 1: keyword matching
    for (const { emotion, keywords, weight } of SIGNALS) {
      for (const kw of keywords) {
        if (lower.includes(kw)) {
          scores.set(emotion, (scores.get(emotion) ?? 0) + weight);
          break; // one keyword match per emotion signal
        }
      }
    }

    // Signal 2: linguistic patterns
    const linguisticSignals = this.analyzeLinguistics(text, lower);
    for (const [emotion, boost] of Object.entries(linguisticSignals)) {
      if (boost && boost > 0) {
        const e = emotion as EmotionState;
        scores.set(e, (scores.get(e) ?? 0) + boost);
      }
    }

    // Signal 3: sentiment valence
    const valence = this.computeValence(lower);

    // Resolve primary emotion
    if (scores.size === 0) {
      if (valence > 0.3)  return { primary:'contentment', secondary:[], intensity:0.4,  valence, arousal:0.35, confidence:0.5 };
      if (valence < -0.3) return { primary:'sadness',     secondary:[], intensity:0.4,  valence, arousal:0.3,  confidence:0.5 };
      return                      { primary:'neutral',    secondary:[], intensity:0.25, valence:0, arousal:0.3, confidence:0.7 };
    }

    const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
    const [primaryEmotion, primaryScore] = sorted[0]!;
    const secondary = sorted.slice(1, 3).map(([e]) => e);

    const intensity  = Math.min(1, primaryScore / 3);
    const confidence = scores.size === 1 ? 0.85 : Math.min(0.9, 0.6 + primaryScore * 0.1);

    return {
      primary:   primaryEmotion,
      secondary,
      intensity,
      valence:   VALENCE[primaryEmotion] ?? valence,
      arousal:   AROUSAL[primaryEmotion] ?? Math.abs(valence) * 0.8,
      confidence,
    };
  }

  // ── Build LLM system prompt instructions ─────────────────────────────────

  buildPromptInstructions(
    state:     EmotionalState,
    memories:  Array<{ label: string; value: string }> = [],
    milestone: string | null = null,
  ): string {
    if (state.primary === 'neutral' && state.confidence >= 0.7) {
      // Don't inject noise for clearly neutral messages
      if (!memories.length && !milestone) return '';
    }

    const lines: string[] = ['\n── Emotional Intelligence Context ──'];

    const mode = RESPONSE_MODE[state.primary] ?? 'Engage naturally with genuine curiosity and warmth.';
    lines.push(`Detected emotion: ${state.primary} (intensity ${(state.intensity * 10).toFixed(0)}/10, confidence ${(state.confidence * 100).toFixed(0)}%)`);

    if (state.secondary.length > 0) {
      lines.push(`Secondary signals: ${state.secondary.join(', ')}`);
    }

    lines.push(`Response approach: ${mode}`);

    if (state.valence < -0.4 && state.intensity > 0.6) {
      lines.push('⚠ High-distress signal detected. Prioritise emotional safety. Do not problem-solve unless explicitly asked.');
    }

    if (memories.length > 0) {
      const factSummary = memories.slice(0, 8).map(m => `${m.label}: ${m.value}`).join(' | ');
      lines.push(`Personalisation context: ${factSummary}`);
    }

    if (milestone) {
      lines.push(`Upcoming milestone: ${milestone} — acknowledge warmly if natural in context.`);
    }

    return lines.join('\n');
  }

  // ── Transition model ──────────────────────────────────────────────────────

  transition(current: EmotionalState, incoming: EmotionalState, turnCount: number): EmotionalState {
    const prevValence = current.valence;
    const newValence  = incoming.valence;

    // Detect abrupt drop (happiness → distress within 1–2 turns)
    if (prevValence > 0.4 && newValence < -0.4 && turnCount < 3) {
      return { ...incoming, confidence: Math.min(1, incoming.confidence + 0.15) };
    }

    // Gradual healing arc: negative emotion with decreasing intensity
    if (prevValence < -0.2 && newValence < -0.2 && incoming.intensity < current.intensity * 0.8) {
      return { ...incoming, primary: current.primary }; // same emotion, less intense
    }

    return incoming;
  }

  // ── Linguistics analysis ────────────────────────────────────────────────────

  private analyzeLinguistics(raw: string, lower: string): Partial<Record<EmotionState, number>> {
    const signals: Partial<Record<EmotionState, number>> = {};
    const len = raw.length;

    const exclamations = (raw.match(/!/g) ?? []).length;
    const ellipsis     = (raw.match(/\.\.\./g) ?? []).length;
    const allCaps      = (raw.match(/\b[A-Z]{3,}\b/g) ?? []).length;
    const questions    = (raw.match(/\?/g) ?? []).length;

    if (exclamations >= 3) signals.excitement = 0.4;
    if (allCaps >= 2)      signals.anger = 0.3;
    if (ellipsis >= 2 && len < 100) signals.sadness = 0.2;
    if (questions >= 3)    signals.confusion = 0.25;
    if (len < 15)           signals.frustration = 0.15; // very short = clipped

    // Emoji signals
    if (raw.includes('😭') || raw.includes('💔')) signals.sadness   = 0.5;
    if (raw.includes('😂') || raw.includes('🤣')) signals.amusement = 0.5;
    if (raw.includes('❤️') || raw.includes('🥰')) signals.love      = 0.4;
    if (raw.includes('😡') || raw.includes('🤬')) signals.anger     = 0.5;
    if (raw.includes('😰') || raw.includes('😨')) signals.anxiety   = 0.5;
    if (raw.includes('🥺') || raw.includes('😔')) signals.sadness   = Math.max(signals.sadness ?? 0, 0.35);

    // Disclosure patterns
    if (lower.includes('honestly') || lower.includes("i've never told") || lower.includes('can i tell you')) {
      signals.trust = 0.3;
    }

    return signals;
  }

  // ── Valence scoring ────────────────────────────────────────────────────────

  private computeValence(text: string): number {
    const words  = text.split(/\s+/);
    let positive = 0;
    let negative = 0;
    let negated  = false;

    for (const word of words) {
      const clean = word.replace(/[^a-z]/g, '');
      if (NEGATORS.has(clean)) { negated = true; continue; }

      if (POSITIVE_WORDS.has(clean)) {
        if (negated) negative += 1.2;
        else         positive += 1.0;
        negated = false;
      } else if (NEGATIVE_WORDS.has(clean)) {
        if (negated) positive += 0.8;
        else         negative += 1.0;
        negated = false;
      } else {
        negated = false;
      }
    }

    const total = positive + negative;
    if (total === 0) return 0;
    return (positive - negative) / total;
  }
}

/** Singleton — stateless, safe to share across requests */
export const emotionEngine = new EmotionEngine();

/** Default/neutral state — used when no prior emotion exists for a pair */
export const NEUTRAL_EMOTION: EmotionalState = {
  primary: 'neutral', secondary: [], intensity: 0.25, valence: 0, arousal: 0.3, confidence: 0.7,
};

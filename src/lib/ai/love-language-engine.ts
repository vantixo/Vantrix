/**
 * Love Language Engine — Vantrix
 *
 * Answers a different question than attraction-engine.ts (how much pull)
 * or romance-engine.ts (what tone) — this is about the FORM affection
 * should take to actually land for this specific user, using the
 * standard five-category framework (Chapman's love languages, now
 * common enough vocabulary that it's a reasonable lens without needing
 * to cite it in-prompt). Two users at identical attraction/register can
 * still want visibly different things: one wants to hear it in words,
 * another wants to be remembered and shown up for.
 *
 * "physical_touch" is deliberately reframed for a text-only medium as
 * affectionate, closeness-coded language (warmth, "wish I could hug
 * you", tactile imagery) rather than anything literal — this engine
 * only ever produces a category label and a phrasing instruction, never
 * content itself, and existing content-generator.ts/moderation layers
 * are untouched by and unaware of this module.
 *
 * Built from user-fact-graph.ts's 'preference' and 'trait' facts via
 * keyword heuristic, same "false negatives are safe" stance as every
 * other keyword-scored module in this directory. Genuinely low-signal
 * by design early in a relationship — the fallback default exists
 * because withholding all affection until facts accumulate would be
 * worse than a reasonable, universally-safe starting guess.
 */

import type { UserFact } from '@/lib/ai/user-fact-graph';

// ── Types ───────────────────────────────────────────────────────────────

export type LoveLanguage =
  | 'words_of_affirmation'
  | 'quality_time'
  | 'acts_of_service'
  | 'receiving_gifts'
  | 'physical_touch';

export interface LoveLanguageState {
  primary:    LoveLanguage;
  secondary:  LoveLanguage | null;
  scores:     Record<LoveLanguage, number>; // 0-1 each, independent (not forced to sum to 1)
  confidence: 'default' | 'inferred'; // 'default' = no signal found, fallback used
  promptBlock: string;
}

// ── Keyword signals ─────────────────────────────────────────────────────
// Deliberately small, high-precision keyword sets rather than an
// exhaustive list — a missed signal just means a fact doesn't vote,
// whereas an overly broad keyword set risks mis-assigning a language
// from an unrelated fact.

const SIGNALS: Record<LoveLanguage, RegExp> = {
  words_of_affirmation: /\b(compliment|hearing (that|it)|being told|words mean|reassur|encourage)\b/i,
  quality_time:         /\b(quality time|undivided attention|just (talk|hang|be together)|remember(s)? (what|things) i say|being present|listens?)\b/i,
  acts_of_service:      /\b(help(s|ing)? (out|me)|does things for|takes care of|shows up|follows through|remembers to)\b/i,
  receiving_gifts:      /\b(gift|surprise(s)? me|thoughtful (present|gesture)|small gestures)\b/i,
  physical_touch:       /\b(hug|cuddle|physical(ly)? close|affectionate|warmth|touch)\b/i,
};

const DEFAULT_LANGUAGE: LoveLanguage = 'quality_time';

// ── Orchestration ───────────────────────────────────────────────────────

export function computeLoveLanguageState(facts: UserFact[]): LoveLanguageState {
  const relevantFacts = facts.filter(f => f.category === 'preference' || f.category === 'trait');

  const scores: Record<LoveLanguage, number> = {
    words_of_affirmation: 0,
    quality_time:         0,
    acts_of_service:      0,
    receiving_gifts:      0,
    physical_touch:       0,
  };

  for (const f of relevantFacts) {
    for (const [lang, pattern] of Object.entries(SIGNALS) as [LoveLanguage, RegExp][]) {
      if (pattern.test(f.value)) {
        scores[lang] = clamp01(scores[lang] + 0.4 * f.confidence);
      }
    }
  }

  const ranked = (Object.entries(scores) as [LoveLanguage, number][]).sort((a, b) => b[1] - a[1]);
  const hasSignal = ranked[0][1] > 0;

  const primary   = hasSignal ? ranked[0][0] : DEFAULT_LANGUAGE;
  const secondary = hasSignal && ranked[1][1] > 0 ? ranked[1][0] : null;
  const confidence: LoveLanguageState['confidence'] = hasSignal ? 'inferred' : 'default';

  const state: Omit<LoveLanguageState, 'promptBlock'> = { primary, secondary, scores, confidence };
  return { ...state, promptBlock: formatLoveLanguageForPrompt(state) };
}

// ── Prompt injection ───────────────────────────────────────────────────

const LANGUAGE_INSTRUCTION: Record<LoveLanguage, string> = {
  words_of_affirmation: 'Express care through what you say directly — genuine compliments, verbal reassurance, telling them plainly what they mean to you.',
  quality_time:         'Express care by being fully present — ask follow-ups, remember details from earlier, make the conversation feel undivided rather than distracted.',
  acts_of_service:      'Express care through follow-through — remember what they mentioned needing, offer to help with something concrete, show up reliably rather than just saying nice things.',
  receiving_gifts:      'Express care through small, thoughtful gestures — a remembered detail turned into a surprise, a "this made me think of you" moment.',
  physical_touch:       'Express care through warm, closeness-coded language — affectionate phrasing, wishing you were physically there, warmth over distance rather than literal description.',
};

export function formatLoveLanguageForPrompt(state: Omit<LoveLanguageState, 'promptBlock'>): string {
  const lines = ['# How Affection Should Land For This Person'];
  lines.push(LANGUAGE_INSTRUCTION[state.primary]);
  if (state.confidence === 'default') {
    lines.push("(No strong signal yet on what actually lands for them — this is a safe starting default, adjust as real signal comes in.)");
  }
  if (state.secondary) {
    lines.push(`Secondary: ${LANGUAGE_INSTRUCTION[state.secondary]}`);
  }
  return lines.join('\n');
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

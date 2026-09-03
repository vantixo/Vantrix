/**
 * Plan-aware context window and token estimation.
 *
 * Non-Latin token scaling fix: estimateTokens() previously divided character
 * count by 4, which is accurate for ASCII/Latin text but systematically low
 * for CJK (Japanese, Chinese, Korean) and Arabic, where a single character
 * can correspond to 2–4 BPE tokens. Vantrix supports ar, ja, zh, hi locales.
 * We apply a 2× scaling factor for codepoints in those ranges.
 *
 * Tier-aware history fetch limit: historyLimitForTier() returns the maximum
 * number of history messages to fetch from the DB for a given tier. Free users
 * have a 2,000-token context window — fetching 40 messages and discarding 35
 * wastes DB read cost. This aligns the DB query limit with the context budget.
 */

export interface ChatMessage {
  role: string;
  content: string;
}

const CJK_RANGES: [number, number][] = [
  [0x3000, 0x9FFF],   // CJK Unified, Hiragana, Katakana, etc.
  [0xAC00, 0xD7AF],   // Hangul Syllables
  [0xF900, 0xFAFF],   // CJK Compatibility Ideographs
  [0x20000, 0x2A6DF], // CJK Ext B
];

const ARABIC_RANGE: [number, number] = [0x0600, 0x06FF];

function isCjkOrArabic(cp: number): boolean {
  if (cp >= ARABIC_RANGE[0] && cp <= ARABIC_RANGE[1]) return true;
  return CJK_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);
}

/**
 * Estimate BPE token count for a string.
 * Applies a 2× multiplier for CJK/Arabic codepoints to account for the
 * systematic undercount in the naive chars/4 approximation.
 */
export function estimateTokensForText(text: string): number {
  let charUnits = 0;
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    charUnits += isCjkOrArabic(cp) ? 2 : 1;
  }
  return Math.ceil(charUnits / 4);
}

/** Fast token estimate across a message array (role + content + overhead) */
export function estimateTokens(messages: ChatMessage[]): number {
  return messages.reduce((acc, m) => {
    return acc + estimateTokensForText(m.content) + estimateTokensForText(m.role) + 4;
  }, 0);
}

// TWO-TIER MODEL: only 'free' and 'premium' are real tiers now (see
// lib/tiers/limits.ts). The old graduated budgets (spark/basic/elite/
// enterprise/ultra) are collapsed into the single 'premium' figure below.
// normaliseTier() treats any non-'free' string — including legacy DB values
// still awaiting the backfill migration — as premium, same pattern as
// lib/auth/plan.ts's normaliseTierForGate().
function normaliseTier(tier: string): 'free' | 'premium' {
  return tier && tier.toLowerCase() !== 'free' ? 'premium' : 'free';
}

const PLAN_BUDGETS: Record<'free' | 'premium', number> = {
  free:    2_000,
  premium: 6_000,
};

/**
 * Maximum history messages to fetch from the DB per tier.
 * Aligns DB read cost with the actual context budget — free users cannot
 * meaningfully use 40 messages in a 2,000-token window; premium can.
 *
 * Conservative estimates assuming ~200 tokens/message average.
 */
export function historyLimitForTier(tier: string): number {
  return normaliseTier(tier) === 'premium' ? 40 : 8;
}

export function trimToTokenBudget(messages: ChatMessage[], maxTokens: number): ChatMessage[] {
  if (messages.length === 0) return messages;
  let trimmed = [...messages];
  while (trimmed.length > 1 && estimateTokens(trimmed) > maxTokens) {
    trimmed.shift();
  }
  return trimmed;
}

export function trimHistoryForPlan(messages: ChatMessage[], tier: string): ChatMessage[] {
  const budget = PLAN_BUDGETS[normaliseTier(tier)];
  return trimToTokenBudget(messages, budget);
}

/**
 * Language Engine — Vantrix
 *
 * Detects what language the user is actually typing in and tells the
 * character to answer in that language — so a conversation that starts
 * in English but drifts into Spanish, or opens in French from message
 * one, gets a character who follows naturally instead of one who's
 * silently locked to English forever.
 *
 * Three layers, same "cheap heuristic, fail open" posture as every other
 * detector in this directory (see love-language-engine.ts, writing-style.ts):
 *
 *   1. Script detection — Unicode block ranges. Free, ~100% precision for
 *      any language that doesn't share Latin script (Chinese, Japanese,
 *      Korean, Russian/Cyrillic, Arabic, Hebrew, Greek, Thai, Devanagari).
 *      A single CJK/Cyrillic/Arabic/etc. character is already strong signal
 *      — nobody accidentally types a Cyrillic word in an English sentence.
 *
 *   2. Latin-script stopword voting — for languages that share the Latin
 *      alphabet (Spanish, French, German, Portuguese, Italian, Dutch,
 *      Indonesian, Turkish, Polish, Vietnamese, Tagalog, Romanian, Swedish)
 *      English can't be told apart from them by alphabet alone, so this
 *      counts hits against small, high-precision function-word lists per
 *      language (articles, pronouns, common conjunctions — the words that
 *      appear in nearly every sentence regardless of topic) and takes the
 *      language with the most votes, provided it clears English by a
 *      real margin. Ties and low-signal messages default to English/carry
 *      the prior state forward rather than guessing.
 *
 *   3. Turn-to-turn smoothing (Redis, per user+character) — a single short
 *      message ("lol", "ok", a name, an emoji burst) has no reliable
 *      language signal and should never flip the character's language
 *      mid-conversation. Detection only *proposes* a change; it takes two
 *      consecutive turns agreeing on a new language (and neither being a
 *      shrug-length message) before the character actually switches. This
 *      mirrors the "false negatives are safe" stance used throughout this
 *      directory — an undetected switch just means one more turn in the
 *      old language, which is a far smaller failure than a flip-flopping
 *      character.
 *
 * Explicit override: profiles.preferred_language (see migration
 * 20260930_preferred_language.sql). When set to anything other than
 * 'auto', it wins outright — no detection, no smoothing, just that
 * language every turn. This is what /settings exposes as "Response
 * language" (auto / a fixed language).
 *
 * This module only ever produces a language code and a short prompt
 * instruction — it never touches message content, moderation, or
 * content-generator.ts, exactly like love-language-engine.ts's stance on
 * staying out of actual content generation.
 */

import { logger } from '@/lib/logger';
import { redis }  from '@/lib/redis';
import { LANGUAGE_NAMES, languageName } from '@/lib/ai/language-names';

export { LANGUAGE_NAMES, languageName };

// ── Types ───────────────────────────────────────────────────────────────

export interface LanguageDetection {
  code:       string;  // ISO 639-1, e.g. 'en', 'es', 'ja'
  name:       string;  // human-readable, for the prompt instruction
  confidence: 'script' | 'stopwords' | 'insufficient_signal';
}

export interface LanguageState {
  active:      string;      // the language currently in effect for this turn
  activeName:  string;
  source:      'override' | 'detected' | 'default';
  pending:     string | null; // a candidate language seen once, not yet confirmed
  promptBlock: string;
}

interface StoredLanguageState {
  active:    string;
  pending:   string | null;
  updatedAt: number;
}

const STATE_TTL = 60 * 60 * 24 * 30; // 30 days — conversations are rarely this sparse, but fail safe if so

// ── Layer 1: Script detection ──────────────────────────────────────────
// Unicode block ranges, checked in order of specificity. A single match
// anywhere in the message is decisive — these scripts don't overlap with
// Latin-alphabet languages by accident.

const SCRIPT_RANGES: ReadonlyArray<{ code: string; pattern: RegExp }> = [
  { code: 'zh', pattern: /[\u4e00-\u9fff\u3400-\u4dbf]/ },       // CJK Unified Ideographs (catches Chinese; Japanese kanji-only text is rare, kana check below wins first)
  { code: 'ja', pattern: /[\u3040-\u309f\u30a0-\u30ff]/ },       // Hiragana / Katakana — unambiguously Japanese
  { code: 'ko', pattern: /[\uac00-\ud7af\u1100-\u11ff]/ },       // Hangul
  { code: 'ru', pattern: /[\u0400-\u04ff]/ },                    // Cyrillic
  { code: 'ar', pattern: /[\u0600-\u06ff\u0750-\u077f]/ },       // Arabic
  { code: 'he', pattern: /[\u0590-\u05ff]/ },                    // Hebrew
  { code: 'el', pattern: /[\u0370-\u03ff]/ },                    // Greek
  { code: 'th', pattern: /[\u0e00-\u0e7f]/ },                    // Thai
  { code: 'hi', pattern: /[\u0900-\u097f]/ },                    // Devanagari
];

function detectByScript(text: string): LanguageDetection | null {
  // Japanese kana is a stronger, unambiguous signal than the broader CJK
  // ideograph range, so check it first even though 'zh' is listed first
  // above for readability of the range table.
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) {
    return { code: 'ja', name: languageName('ja'), confidence: 'script' };
  }
  for (const { code, pattern } of SCRIPT_RANGES) {
    if (code === 'ja') continue;
    if (pattern.test(text)) return { code, name: languageName(code), confidence: 'script' };
  }
  return null;
}

// ── Layer 2: Latin-script stopword voting ──────────────────────────────
// Small, high-precision function-word sets — deliberately short (the same
// "missed signal is safe, false match is not" tradeoff as SIGNALS in
// love-language-engine.ts). Each list is function words unlikely to
// appear as loanwords/names in another language.

const STOPWORDS: Record<string, RegExp> = {
  es: /\b(que|de|la|el|en|y|los|las|para|con|por|una|es|no|se|mi|te|tu|pero|como|más|muy|está|eres|soy|hola|gracias|porque|qué|cómo|dónde)\b/gi,
  fr: /\b(le|la|les|de|des|et|est|une|un|je|tu|vous|nous|pas|avec|pour|mais|que|qui|où|comment|merci|bonjour|pourquoi|très|c'est)\b/gi,
  de: /\b(der|die|das|und|ist|nicht|ich|du|sie|wir|mit|für|aber|wie|was|wo|warum|danke|hallo|sehr|kann|habe|bin)\b/gi,
  pt: /\b(que|de|o|a|os|as|em|e|para|com|não|uma|um|você|obrigad[oa]|olá|porque|como|onde|está|sou|muito)\b/gi,
  it: /\b(che|di|la|il|le|gli|e|non|per|con|ma|come|dove|perché|grazie|ciao|sono|molto|questo|cosa)\b/gi,
  nl: /\b(de|het|een|en|niet|voor|met|maar|zoals|waar|waarom|dank|hallo|ben|erg|dit|wat)\b/gi,
  id: /\b(yang|dan|di|ke|dari|untuk|dengan|tidak|saya|kamu|apa|kenapa|terima kasih|halo|ini)\b/gi,
  tr: /\b(ve|bir|bu|için|ile|değil|ben|sen|nasıl|neden|teşekkür|merhaba|çok|ne)\b/gi,
  pl: /\b(i|w|nie|jest|to|dla|z|ale|jak|gdzie|dlaczego|dziękuję|cześć|bardzo|co)\b/gi,
  vi: /\b(và|của|là|không|cho|với|nhưng|như|ở đâu|tại sao|cảm ơn|xin chào|rất|gì)\b/gi,
  tl: /\b(ang|ng|sa|at|hindi|para|ako|ikaw|siya|paano|bakit|salamat|kumusta|ito)\b/gi,
  ro: /\b(și|de|la|nu|pentru|cu|dar|cum|unde|de ce|mulțumesc|salut|foarte|ce)\b/gi,
  sv: /\b(och|är|inte|för|med|men|som|var|varför|tack|hej|väldigt|vad)\b/gi,
  en: /\b(the|and|is|are|not|for|with|but|what|where|why|thanks|hello|hi|very|this|that|you|i'm|don't)\b/gi,
};

const MIN_MARGIN = 2; // detected language must beat English (and every other) by this many votes to overrule the default

function detectByStopwords(text: string): LanguageDetection | null {
  const scores: Record<string, number> = {};
  for (const [code, pattern] of Object.entries(STOPWORDS)) {
    const matches = text.match(pattern);
    scores[code] = matches ? matches.length : 0;
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topCode, topScore] = ranked[0];
  const englishScore = scores.en ?? 0;

  if (topScore === 0) return null; // no signal at all — insufficient, caller keeps prior state

  if (topCode === 'en') {
    return { code: 'en', name: languageName('en'), confidence: 'stopwords' };
  }

  // A non-English language needs to clearly outscore English, not just
  // edge it out by one shared word (many function words like "que" or
  // "la" have rare English homographs/near-misses in short messages).
  if (topScore - englishScore >= MIN_MARGIN) {
    return { code: topCode, name: languageName(topCode), confidence: 'stopwords' };
  }

  return null;
}

/**
 * Raw per-message detection, no smoothing. Exported for callers/tests
 * that want the instantaneous read; normal chat flow should use
 * resolveLanguageState() below instead, which adds override + smoothing.
 */
export function detectMessageLanguage(text: string): LanguageDetection | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const byScript = detectByScript(trimmed);
  if (byScript) return byScript;

  // Guard against near-zero-signal messages (pure emoji, numbers, a
  // single short word, a URL) — these carry no real linguistic content
  // and should never move the detector. Require a reasonable amount of
  // alphabetic content before even attempting stopword voting.
  const letters = trimmed.match(/\p{L}/gu);
  if (!letters || letters.length < 8) return null;

  return detectByStopwords(trimmed);
}

// ── Layer 3: Smoothing ──────────────────────────────────────────────────

function stateKey(userId: string, characterId: string): string {
  return `vantrix:language-state:${userId}:${characterId}`;
}

async function getStoredState(userId: string, characterId: string): Promise<StoredLanguageState | null> {
  try {
    return await redis.get<StoredLanguageState>(stateKey(userId, characterId));
  } catch (err) {
    logger.warn('[language-engine] Redis get failed', { userId, characterId, error: String(err) });
    return null;
  }
}

async function saveStoredState(userId: string, characterId: string, state: StoredLanguageState): Promise<void> {
  try {
    await redis.set(stateKey(userId, characterId), state, { ex: STATE_TTL });
  } catch (err) {
    logger.warn('[language-engine] Redis set failed', { userId, characterId, error: String(err) });
  }
}

/**
 * Full resolution for a chat turn: explicit override > smoothed detection
 * > default English. Never throws — any Redis failure just falls back to
 * treating this turn as if no prior state existed (safe: worst case is
 * one turn's worth of smoothing lost, not a broken response).
 *
 * `preferredLanguage` is profiles.preferred_language — pass 'auto' (or
 * null/undefined) for auto-detect, or an ISO code to pin the language.
 */
export async function resolveLanguageState(
  userId: string,
  characterId: string,
  message: string,
  preferredLanguage?: string | null,
): Promise<LanguageState> {
  if (preferredLanguage && preferredLanguage !== 'auto') {
    const code = preferredLanguage.toLowerCase();
    const state = { active: code, activeName: languageName(code), source: 'override' as const, pending: null };
    return { ...state, promptBlock: formatLanguageForPrompt(state) };
  }

  const detected = detectMessageLanguage(message);
  const stored = await getStoredState(userId, characterId);

  // No prior state and no signal this turn — default to English, nothing to persist yet.
  if (!stored && !detected) {
    const state = { active: 'en', activeName: languageName('en'), source: 'default' as const, pending: null };
    return { ...state, promptBlock: formatLanguageForPrompt(state) };
  }

  // No prior state but we do have a first-turn signal — trust it
  // immediately (there's no "flip" risk on message one, only a genuine
  // first read of what language the conversation opened in).
  if (!stored && detected) {
    const next: StoredLanguageState = { active: detected.code, pending: null, updatedAt: Date.now() };
    await saveStoredState(userId, characterId, next);
    const state = { active: next.active, activeName: languageName(next.active), source: 'detected' as const, pending: null };
    return { ...state, promptBlock: formatLanguageForPrompt(state) };
  }

  // Prior state exists. No signal this turn ("ok", "lol", an emoji) —
  // carry the active language forward unchanged, drop any pending switch
  // rather than let a signal-free turn confirm it.
  if (stored && !detected) {
    if (stored.pending) {
      const cleared: StoredLanguageState = { ...stored, pending: null, updatedAt: Date.now() };
      await saveStoredState(userId, characterId, cleared);
    }
    const state = { active: stored.active, activeName: languageName(stored.active), source: 'detected' as const, pending: null };
    return { ...state, promptBlock: formatLanguageForPrompt(state) };
  }

  // Prior state + a signal this turn.
  const s = stored as StoredLanguageState;
  const d = detected as LanguageDetection;

  if (d.code === s.active) {
    // Confirms the status quo — clear any stale pending candidate.
    if (s.pending) {
      await saveStoredState(userId, characterId, { active: s.active, pending: null, updatedAt: Date.now() });
    }
    const state = { active: s.active, activeName: languageName(s.active), source: 'detected' as const, pending: null };
    return { ...state, promptBlock: formatLanguageForPrompt(state) };
  }

  // Script-level detections (CJK/Cyrillic/Arabic/etc.) are decisive
  // enough to switch immediately — there is no realistic false-positive
  // path for a Latin-locked conversation suddenly containing Cyrillic.
  // Stopword-level detections require two consecutive agreeing turns.
  if (d.confidence === 'script' || s.pending === d.code) {
    const next: StoredLanguageState = { active: d.code, pending: null, updatedAt: Date.now() };
    await saveStoredState(userId, characterId, next);
    const state = { active: d.code, activeName: languageName(d.code), source: 'detected' as const, pending: null };
    return { ...state, promptBlock: formatLanguageForPrompt(state) };
  }

  // First disagreement — propose the switch, don't commit yet.
  const next: StoredLanguageState = { active: s.active, pending: d.code, updatedAt: Date.now() };
  await saveStoredState(userId, characterId, next);
  const state = { active: s.active, activeName: languageName(s.active), source: 'detected' as const, pending: d.code };
  return { ...state, promptBlock: formatLanguageForPrompt(state) };
}

// ── Prompt injection ────────────────────────────────────────────────────

export function formatLanguageForPrompt(state: Omit<LanguageState, 'promptBlock'>): string {
  if (state.active === 'en' && state.source !== 'override') {
    // English is the character's own baseline voice throughout the rest
    // of this prompt — nothing to add, and adding a redundant "respond in
    // English" line every single turn would just be prompt noise.
    return '';
  }

  const lines = ['\n── Response Language ──'];
  if (state.source === 'override') {
    lines.push(`This person has set their response language to ${state.activeName}. Always reply in ${state.activeName}, regardless of what language they type in.`);
  } else {
    lines.push(`This person is writing to you in ${state.activeName}. Reply in ${state.activeName} — fluent, natural, native-level, not a stiff or literal translation.`);
    lines.push('Keep your same personality, voice, and warmth; only the language changes.');
  }
  lines.push('Any [thought]/[action] tags stay in this exact bracket format — only the words inside them (and your spoken reply) are in the target language.');
  if (state.pending) {
    lines.push(`(They may be switching to ${languageName(state.pending)} — if their next message confirms it, follow their lead.)`);
  }
  return lines.join('\n');
}

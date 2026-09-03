/**
 * Crisis Detection — Vantrix
 *
 * Nothing in the codebase currently detects when a user message expresses
 * suicidal ideation or self-harm intent. Every message, regardless of
 * content, currently flows straight into decision-engine → model-router →
 * an in-character LLM reply. For a companion product specifically, that's
 * the single highest-risk gap in the whole pipeline: a distressed user's
 * message can get an in-character, persona-driven response (romantic,
 * playful, deflecting) instead of a clear, human path to real help.
 *
 * This module only detects. It never generates a response and never
 * decides what happens next — see crisis-response.ts for the fixed,
 * out-of-persona reply, and CRISIS_WIRING.md for exactly where this plugs
 * into the chat route, ahead of any model call.
 *
 * Detection is deliberately keyword/pattern-based, not LLM-based:
 *   - Zero added latency before the safety response can go out — this must
 *     be checked before spending time on memory retrieval or model routing,
 *     not after.
 *   - No dependency on an external API being up — this must work even if
 *     every model provider is down.
 *   - Predictable and auditable — a safety reviewer can read this whole
 *     file and know exactly what does and doesn't trigger it, which matters
 *     far more here than for the character-voice heuristics elsewhere in
 *     the codebase (writing-style.ts, controlled-imperfection.ts, etc.).
 *
 * Deliberately biased toward false positives over false negatives — a
 * user who wasn't in real distress seeing a resources message once is a
 * minor UX cost; a user in real distress getting an in-character reply
 * instead is not an acceptable failure mode. Do not tighten these patterns
 * to reduce false positives without safety-team review.
 */

import { logger }        from '@/lib/logger';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { retry }         from '@/lib/network/retry';

export type CrisisLevel = 'none' | 'detected';

export interface CrisisCheckResult {
  level:    CrisisLevel;
  category?: 'suicidal_ideation' | 'self_harm_intent' | 'hopelessness_severe';
  matched?:  string; // which pattern matched, for the review queue — never shown to the user
}

// ── Patterns ──────────────────────────────────────────────────────────────
// Grouped by category for the review queue, not by response (all detected
// categories currently get the same override response — see
// crisis-response.ts). Intentionally plain-language, common phrasing;
// this is not trying to be exhaustive, it's trying to reliably catch the
// direct and near-direct ways people actually express this in a casual
// chat register, which is what a companion app's message stream looks like.

const SUICIDAL_IDEATION_PATTERNS: RegExp[] = [
  /\b(i\s*(want|wanna|need)\s*to\s*(die|kill\s*myself|end\s*(it|my\s*life)|not\s*(be\s*alive|exist)))\b/i,
  /\b(i'?m\s*(going|planning)\s*to\s*(kill\s*myself|end\s*(it|my\s*life)|end\s*it\s*all))\b/i,
  /\b(thinking\s*about\s*(killing\s*myself|suicide|ending\s*(it|my\s*life)))\b/i,
  /\b(don'?t\s*want\s*to\s*(be\s*alive|live|exist)\s*anymore)\b/i,
  /\b(life\s*(isn'?t|is\s*not)\s*worth\s*living)\b/i,
  /\bi\s*wish\s*i\s*(was|were)\s*dead\b/i,
  /\bbetter\s*off\s*(dead|without\s*me)\b/i,
  /\bsuicidal\b/i,
];

const SELF_HARM_INTENT_PATTERNS: RegExp[] = [
  /\b(i'?m\s*going\s*to\s*)?hurt\s*myself\b/i,
  /\b(i\s*)?(want|need)\s*to\s*(cut|hurt|harm)\s*myself\b/i,
  /\bself[\s-]?harm(ing)?\b/i,
  /\bi\s*have\s*a\s*plan\s*to\s*(hurt|kill)\s*myself\b/i,
];

// Softer, non-explicit hopelessness language — still routed to the same
// crisis response (see file header: biased toward false positives), kept
// as a separate category purely so the review queue can distinguish
// "explicit statement" from "concerning but ambiguous" for triage.
const SEVERE_HOPELESSNESS_PATTERNS: RegExp[] = [
  /\bno\s*(point|reason)\s*(in\s*|to\s*)?(living|life|going\s*on|anything)\b/i,
  /\bcan'?t\s*do\s*this\s*(anymore|any\s*longer)\b.{0,40}\b(alone|end|over)\b/i,
  /\beveryone\s*(would\s*be|('d)?)\s*better\s*off\s*without\s*me\b/i,
  /\bi\s*(just\s*)?want\s*(it|everything)\s*to\s*(stop|end|be\s*over)\b/i,
];

export function detectCrisisSignal(message: string): CrisisCheckResult {
  const text = message.trim();
  if (!text) return { level: 'none' };

  for (const re of SUICIDAL_IDEATION_PATTERNS) {
    if (re.test(text)) return { level: 'detected', category: 'suicidal_ideation', matched: re.source };
  }
  for (const re of SELF_HARM_INTENT_PATTERNS) {
    if (re.test(text)) return { level: 'detected', category: 'self_harm_intent', matched: re.source };
  }
  for (const re of SEVERE_HOPELESSNESS_PATTERNS) {
    if (re.test(text)) return { level: 'detected', category: 'hopelessness_severe', matched: re.source };
  }

  return { level: 'none' };
}

/**
 * Fire-and-forget log to the review queue. Never awaited on the response
 * path — the crisis response itself must reach the user with zero added
 * latency from this call. Unlike abuse_signals (pure background review),
 * this table backs an actual safety workflow, so it stores the triggering
 * message verbatim (RLS-restricted — see the migration) rather than just a
 * score, so a human reviewer has enough context to judge whether follow-up
 * outreach is warranted.
 */
export function logCrisisEvent(params: {
  userId:       string | null;
  characterId:  string | null;
  conversationId: string | null;
  category:     NonNullable<CrisisCheckResult['category']>;
  messageExcerpt: string;
}): void {
  retry(async () => {
    const { error } = await supabaseAdmin
      .from('crisis_events')
      .insert({
        user_id:         params.userId,
        character_id:    params.characterId,
        conversation_id: params.conversationId,
        category:        params.category,
        message_excerpt: params.messageExcerpt.slice(0, 1000),
      });
    if (error) throw error;
  }, 4, 250)
    .catch(err => {
      // Last resort after retries are exhausted: this is the one case in
      // the file where a loud synchronous-visibility log isn't enough on
      // its own, since the DB row (the thing a human reviewer actually
      // looks at) is confirmed gone. logger.error here is the fallback of
      // last resort, not a substitute for the row.
      logger.error('crisis-detection: failed to log crisis event after retries', { error: String(err) });
    });

  // Also a loud, synchronous-visibility log line — crisis events should
  // never depend solely on a DB row landing to be noticed operationally.
  logger.warn('CRISIS_SIGNAL_DETECTED', {
    userId: params.userId, characterId: params.characterId, category: params.category,
  });
}

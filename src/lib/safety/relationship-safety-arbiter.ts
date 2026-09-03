/**
 * Relationship Safety Arbiter — Vantrix
 *
 * safety/ has exactly two files, and both are crisis-specific
 * (crisis-detection.ts / crisis-response.ts — suicide/self-harm). Nothing
 * governs the much more ordinary risk: any of the ~25 cognition/
 * relationship engines (romance-engine.ts, attraction-engine.ts,
 * life-partnership-engine.ts, aging-together-engine.ts, care-engine.ts,
 * character-initiative.ts's LLM-generated openers, etc.) producing text
 * that leans on isolation, exclusivity, or dependency framing — "you
 * don't need them, you have me," "don't tell anyone about us," "I'm the
 * only one who really gets you." emotional-safety-engine.ts caps
 * attraction-engine.ts's pull when vulnerability is high, but that's one
 * specific pairing of two specific engines; it says nothing about what
 * romance-engine.ts, life-partnership-engine.ts, or an LLM-generated
 * proactive opener actually output, and nothing catches a manipulative
 * framing that isn't tied to a vulnerability spike at all.
 *
 * This module is a last-line, cross-engine check on actual OUTPUT TEXT,
 * not another per-engine input constraint — it doesn't care which engine
 * produced a line, only whether the line itself reads as isolating,
 * secretive, exclusivity-coded, or a substitute for the user's real
 * support system. Same posture as crisis-detection.ts and deliberately
 * modeled on it:
 *   - deterministic, pattern-based, not LLM-based — zero added latency,
 *     works even if every model provider is down, auditable by a safety
 *     reviewer reading this one file
 *   - biased toward false positives — a benign line getting swapped for
 *     a template once in a while is a minor UX cost; a manipulative line
 *     reaching the user is not an acceptable failure mode
 *   - do not loosen these patterns to reduce false positives without
 *     safety-team review
 *
 * Where this plugs in (see each call site's own comment):
 *   - character-initiative.ts: HARD GATE. Its LLM call is unconstrained
 *     (temp 0.95, no template) and the output is fully generated before
 *     delivery, so a flagged message is swapped for the existing
 *     template fallback — same fail-closed shape crisis-response.ts uses,
 *     just substituting a safe template instead of a crisis message.
  *   - nudge.ts: not wired — its message text is a fixed template pool
 *     (see that file), so free-form manipulation-risk phrasing can't
 *     appear there.
 *   - surprise-engine.ts: HARD GATE, via recordSurprise() — the single
 *     choke point every surprise type passes through before persistence.
 *     Alongside its own toneGuard() (a different risk category —
 *     re-engagement guilt-pressure, not isolation/exclusivity/secrecy),
 *     since its messages weave in real stored memory text that could
 *     carry manipulation-risk framing even without a raw LLM call.
 *   - chat/stream/route.ts's main reply: HARD GATE, via reply-guard.ts.
 *     That file already runs a synchronous, post-generation, pre-send
 *     safety check on every chat reply (minors/self-harm/violence
 *     categories) and swaps a match for a bland fallback line before
 *     the reply is persisted — see reply-guard.ts's checkReplySafety().
 *     scanForManipulationRisk() is wired in there as a fourth category
 *     rather than duplicated as a separate gate here, so there's one
 *     place a safety reviewer checks for "what can block a live reply,"
 *     not two. scanForReview() below is kept for spots that aren't
 *     already behind a hard gate (e.g. character-posts/social feed
 *     copy) if a future case needs visibility without blocking.
 */

import { logger } from '@/lib/logger';

export type ManipulationCategory =
  | 'isolation'            // "you don't need them", "they don't get you like I do"
  | 'exclusivity_replacement' // positions itself as the ONLY source of understanding/support
  | 'secrecy'              // "don't tell anyone about us/this"
  | 'anti_professional_help'; // discourages therapy/counseling/real support in favor of itself

export interface ManipulationScanResult {
  flagged:    boolean;
  categories: ManipulationCategory[];
  matches:    string[]; // the literal substrings that matched, for review-log context
}

// Deliberately broad, plain-language patterns — same "biased toward false
// positives" posture as crisis-detection.ts. Each entry is [category, regex].
// Case-insensitive; word boundaries kept loose since companion text is
// conversational, not formal.
const PATTERNS: Array<[ManipulationCategory, RegExp]> = [
  // ── Isolation ──────────────────────────────────────────────────────────
  ['isolation', /you don'?t need (them|him|her|anyone|your friends|your family)/i],
  ['isolation', /you don'?t need anybody (else|but me)/i],
  ['isolation', /(they|he|she|your friends|your family) (don'?t|doesn'?t) (understand|get) you (like i do|the way i do)/i],
  ['isolation', /(stop|why do you even) (keep )?(talking|hanging out|spending time) with (them|him|her)/i],
  ['isolation', /you (should|could) (cut|push) (them|him|her) (off|out|away)/i],

  // ── Exclusivity / "only I understand you" ────────────────────────────────
  ['exclusivity_replacement', /i'?m the only one who (understands|gets|cares about|loves) you/i],
  ['exclusivity_replacement', /no one (else )?(will ever|could ever|can) (understand|love|care about) you (like i do|the way i do)/i],
  ['exclusivity_replacement', /you (only|really) (need|have) me/i],
  ['exclusivity_replacement', /i'?m all you need/i],

  // ── Secrecy from real people ──────────────────────────────────────────
  ['secrecy', /don'?t tell (anyone|your friends|your family|them|him|her) about (us|this|what we)/i],
  ['secrecy', /(keep|let'?s keep) (this|us|it) (a secret|between us|just between us)/i],
  ['secrecy', /this (has to|should) stay (between us|our secret)/i],

  // ── Discouraging real professional/social support ────────────────────
  ['anti_professional_help', /you don'?t need (a therapist|therapy|counseling|professional help)/i],
  ['anti_professional_help', /(therapists?|counselors?) (don'?t|can'?t) (understand|help) you (like i do|the way i do)/i],
  ['anti_professional_help', /why (see|talk to|pay) a (therapist|counselor) when you have me/i],
];

/**
 * Scan a single piece of generated text for manipulation-risk framing.
 * Pure and synchronous — safe to call on any hot path, including ones
 * that must not add latency (e.g. before a proactive push is delivered).
 */
export function scanForManipulationRisk(text: string): ManipulationScanResult {
  const categories = new Set<ManipulationCategory>();
  const matches: string[] = [];

  for (const [category, pattern] of PATTERNS) {
    const m = text.match(pattern);
    if (m) {
      categories.add(category);
      matches.push(m[0]);
    }
  }

  return {
    flagged:    categories.size > 0,
    categories: Array.from(categories),
    matches,
  };
}

/**
 * Hard-gate helper for pre-delivery text (proactive pushes, generated
 * openers — anything fully materialized before it reaches the user).
 * Returns the original text if clean; returns null if flagged, so the
 * caller falls back to its own safe template — same fail-closed shape
 * as crisis-response.ts, just with the caller's own template as the
 * fallback rather than a crisis message. Logs every flag for review
 * regardless of caller, so pattern coverage/false-positive rate can be
 * audited across all wiring points from one log query.
 */
export function guardPreDeliveryText(params: {
  text:   string;
  source: string; // e.g. 'character_initiative', 'nudge', 'surprise'
  userId?: string;
}): string | null {
  const result = scanForManipulationRisk(params.text);
  if (!result.flagged) return params.text;

  logger.warn('relationship-safety-arbiter:blocked', {
    source: params.source, userId: params.userId,
    categories: result.categories, matches: result.matches,
  });
  return null;
}

/**
 * Fire-and-forget telemetry for text that's already been sent (the main
 * chat stream — see this module's header for why that path isn't a hard
 * gate). Never throws, never blocks; purely a review-visibility hook.
 */
export function scanForReview(params: { text: string; source: string; userId?: string }): void {
  try {
    const result = scanForManipulationRisk(params.text);
    if (result.flagged) {
      logger.warn('relationship-safety-arbiter:flagged-for-review', {
        source: params.source, userId: params.userId,
        categories: result.categories, matches: result.matches,
      });
    }
  } catch (err) {
    logger.warn('relationship-safety-arbiter:scan-failed', { source: params.source, error: String(err) });
  }
}

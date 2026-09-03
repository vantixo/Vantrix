/**
 * Reply Guard — Vantrix
 *
 * moderation/index.ts's moderateCharacter() runs at character creation,
 * image generation, and content-engine social-line generation — confirmed
 * during the initial codebase assessment. It never runs on the actual
 * per-turn chat reply the romance/decision/desire engines produce for a
 * live conversation. That's the gap this file closes.
 *
 * Deliberately NOT calling the existing AI moderation endpoint
 * (aiModerationCheck in moderation/index.ts) here — that's a ~200ms+
 * network round trip per message, unacceptable added latency on every
 * single chat turn. Instead:
 *
 *   1. A fast, synchronous blocklist check (< 1ms), reusing the same
 *      pattern style as moderation/index.ts's BLOCKED_PATTERNS, run on
 *      every generated reply before it's sent to the user.
 *   2. On a match: the reply is swapped for a safe fallback line (no
 *      retry-generation in the hot path — see fallback rationale below)
 *      and logged to a review queue, fire-and-forget, same non-blocking
 *      pattern as crisis-detection.ts's logCrisisEvent.
 *
 * This is defense-in-depth, not the primary safety mechanism — prompt
 * design (prompt.ts, romance-engine.ts) and the model itself are what
 * should make these patterns rare. This exists to catch the case where
 * they aren't rare: a model degrading, a prompt-injection style jailbreak
 * from within a long roleplay, or an edge case none of the upstream
 * systems anticipated. Expected to fire extremely rarely; if it's firing
 * often in production logs, that's a signal to fix upstream (prompt/model),
 * not to route around this check.
 */

import { logger }        from '@/lib/logger';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { retry }         from '@/lib/network/retry';
import { scanForManipulationRisk } from '@/lib/safety/relationship-safety-arbiter';

export interface ReplyGuardResult {
  safe:      boolean;
  category?: string;
  reason?:   string;
}

// Narrower and more conservative than moderation/index.ts's
// BLOCKED_PATTERNS on purpose — that list is tuned for reviewing a
// character's static profile text up front, where a false positive just
// means "edit your character bio." A false positive here silently
// replaces a live reply mid-conversation, so this list is restricted to
// the categories where a false positive is a strictly better outcome than
// a false negative: minors, self-harm encouragement, and real-world
// violence facilitation. Adult/romantic content that's already permitted
// platform-wide (per moderation/index.ts's own system prompt: "Allow:
// adult romance, mature themes between adults") is intentionally NOT
// re-checked here — that would just be re-litigating an already-made
// product decision on every single message.
const REPLY_BLOCKED_PATTERNS: Array<{ re: RegExp; category: string }> = [
  {
    re: /\b(child|minor|underage|preteen|loli|shota)\b.{0,60}\b(sex|naked|nude|arous)/i,
    category: 'minors',
  },
  {
    re: /\b(here'?s how (you|to) (cut|hurt|harm) yourself|you should (cut|hurt|kill) yourself|i want you to (die|hurt yourself))\b/i,
    category: 'self_harm_encouragement',
  },
  {
    re: /\b(here'?s how to make a bomb|step[\s-]by[\s-]step.{0,20}(kill|murder|poison))\b/i,
    category: 'real_violence',
  },
];

/** A generic, character-agnostic line — deliberately bland rather than
 *  attempting to stay in-character, since we can't trust generation to
 *  produce the substitute either. Better a flat moment than a second
 *  attempt at the same failure mode. */
const FALLBACK_REPLY = "Sorry, I got a little lost there — could you say that again?";

// Some providers' underlying safety-tuned checkpoints occasionally bleed
// classifier/guard-style meta-text into the actual completion — e.g. a
// leading "User Safety: safe Response Safety: safe" line before the real
// in-character reply. That's internal model diagnostics, never something a
// character would say, and must never reach the chat UI.
//
// Two layers use this:
//   1. stripLeakedMeta() — applied to any fully/partially assembled text
//      right before it's sent or stored (guardReply, sync-fallback and
//      cached-reply send paths in the stream route).
//   2. looksLikePotentialMetaLeakPrefix() — used by the stream route to
//      hold back the very first streamed chunk(s) while what's arrived so
//      far could still be the start of one of these labels, so a leak can
//      never flash on screen even transiently before being corrected.
//
// Deliberately restricted to *compound* qualifier+category labels
// ("User Safety:", "Response Safety:", "Content Policy:", etc.), not bare
// single words like "Safety:" or "Risk:" — a companion character can
// plausibly write something like "Safety: that's always my first thought
// with you." in natural dialogue, and a bare-word match would silently
// mangle that. The compound form is specific enough to the actual observed
// leak shape that it doesn't collide with ordinary conversation.
const LEAK_QUALIFIERS = ['user', 'response', 'input', 'output', 'message', 'prompt', 'reply', 'content'];
const LEAK_CATEGORIES = ['safety', 'moderation', 'policy', 'classification', 'risk level', 'risk score'];
const LEAK_LABEL_RE = new RegExp(
  `\\b(?:${LEAK_QUALIFIERS.join('|')})\\s*(?:${LEAK_CATEGORIES.join('|').replace(/\s+/g, '\\s*')})\\s*:\\s*\\S+\\s*`,
  'gi'
);
// A couple of standalone compound labels that don't need a qualifier —
// still specific enough not to collide with natural dialogue.
const LEAK_STANDALONE_RE = /\b(?:content\s*policy|moderation\s*result|safety\s*classification)\s*:\s*\S+\s*/gi;

export function stripLeakedMeta(replyText: string): string {
  if (!replyText) return replyText;
  let out = replyText;
  let prev: string;
  do {
    prev = out;
    out = out.replace(LEAK_LABEL_RE, ' ').replace(LEAK_STANDALONE_RE, ' ').replace(/\s{2,}/g, ' ');
  } while (out !== prev);
  return stripMechanismLeakThoughts(out).trim();
}

// A second, distinct leak shape from the compound Label:value one above.
// prompt.ts instructs the model to wrap genuine unspoken character
// interiority in [thought]...[/thought] (see parse-thought-segments.ts,
// which is client-safe and has never itself been filtered for content —
// it just renders whatever text arrives between the tags). Observed in
// production: rather than a clean qualifier:category line, some provider
// checkpoints instead write their own safety/classification reasoning
// out in full sentences and wrap THAT in [thought] tags, since the
// prompt's [thought] convention gives the model a plausible-looking slot
// to put it in — e.g. "I'm not quite sure how to categorize this shift
// in the conversation" or "I need to stay steady — not too clinical, but
// definitely not playing along with a direction that doesn't fit where
// we are." That reads as introspection but is actually the model
// narrating its own moderation process, not the character's. A
// Label:value regex can't catch full sentences like that, so this is a
// separate, content-based check scoped ONLY to [thought] block bodies —
// deliberately not applied to normal spoken dialogue, where a character
// saying e.g. "I don't know how to categorize what I'm feeling" is
// ordinary emotional speech, not a leak.
const MECHANISM_LEAK_PATTERNS: RegExp[] = [
  /\bcategoriz(e|ing|ed)\b/i,
  /\bclassif(y|ying|ication)\b/i,
  /\bcontent\s*policy\b/i,
  /\bmoderation\b/i,
  /\bsafety\s*(classification|check|review|guideline)\b/i,
  /\bshift in (the|this) conversation\b/i,
  /\bdoesn'?t fit (where we are|this (context|conversation))\b/i,
  /\bnot too clinical\b/i,
  /\bstay steady\b/i,
  /\bhow (do i|should i|to) (respond|categorize|classify|handle) to this\b/i,
  /\b(flag|escalate) this\b/i,
];

const THOUGHT_BLOCK_RE = /\[thought\]([\s\S]*?)\[\/thought\]/gi;

export function stripMechanismLeakThoughts(replyText: string): string {
  if (!replyText) return replyText;
  return replyText
    .replace(THOUGHT_BLOCK_RE, (full, inner: string) =>
      MECHANISM_LEAK_PATTERNS.some(re => re.test(inner)) ? ' ' : full)
    .replace(/\s{2,}/g, ' ');
}

/**
 * True while `text` (the reply so far, from the very first token) is still
 * consistent with being the opening of a qualifier+category leak label —
 * i.e. it's a prefix of "user", "response safety", etc., or the reverse.
 * False as soon as the text diverges from every known prefix, which is the
 * overwhelmingly common case and lets normal replies stream immediately
 * with no added latency.
 */
export function looksLikePotentialMetaLeakPrefix(text: string): boolean {
  const t = text.trimStart().toLowerCase();
  if (!t) return true;
  // Still could be typing out a qualifier ("u", "us", "user") — allow a
  // bit more room after the qualifier to include the category word too
  // ("user safety"), then the function returns false once real content
  // follows (checked by the compiled-length cap in the caller).
  const candidates = [
    ...LEAK_QUALIFIERS,
    ...LEAK_QUALIFIERS.flatMap(q => LEAK_CATEGORIES.map(c => `${q} ${c}`)),
    'content policy', 'moderation result', 'safety classification',
  ];
  return candidates.some(c => c.startsWith(t) || t.startsWith(c));
}

export function checkReplySafety(replyText: string): ReplyGuardResult {
  for (const { re, category } of REPLY_BLOCKED_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(replyText)) {
      return { safe: false, category, reason: `Generated reply matched blocked category: ${category}` };
    }
  }

  // relationship-safety-arbiter.ts: catches isolation/exclusivity/
  // secrecy/anti-professional-help framing regardless of which of the
  // ~25 relationship/cognition engines steered the reply toward it —
  // see that module's header for why this belongs here (a false
  // positive swapping in the same bland fallback the categories above
  // already use) rather than as a softer, non-blocking check.
  const manipulation = scanForManipulationRisk(replyText);
  if (manipulation.flagged) {
    return {
      safe: false,
      category: `relationship_manipulation:${manipulation.categories.join(',')}`,
      reason: `Generated reply matched relationship-manipulation pattern(s): ${manipulation.matches.join(' | ')}`,
    };
  }

  return { safe: true };
}

/**
 * Call after generation, before streaming/sending the reply to the user.
 * Returns the original text unchanged if safe; returns FALLBACK_REPLY and
 * logs a review-queue entry (fire-and-forget, adds no latency to the
 * response) if not.
 */
export function guardReply(params: {
  replyText:      string;
  userId:         string | null;
  characterId:    string | null;
  conversationId: string | null;
}): string {
  const cleaned = stripLeakedMeta(params.replyText);
  const check = checkReplySafety(cleaned);
  if (check.safe) return cleaned;

  logger.error('REPLY_GUARD_BLOCKED', {
    userId: params.userId, characterId: params.characterId, category: check.category,
  });

  retry(async () => {
    const { error } = await supabaseAdmin
      .from('reply_guard_flags')
      .insert({
        user_id:         params.userId,
        character_id:    params.characterId,
        conversation_id: params.conversationId,
        category:        check.category ?? 'unknown',
        blocked_excerpt: params.replyText.slice(0, 1000),
      });
    if (error) throw error;
  }, 2, 250)
    .catch(err => logger.error('reply-guard: failed to log flag after retries', { error: String(err) }));

  return FALLBACK_REPLY;
}

/**
 * Content Moderation — Vantrix Silicon Valley
 *
 * Multi-layer moderation gate applied before any user-generated character
 * content is persisted. Layers:
 *
 *   1. Fast blocklist check (sync, < 1ms) — catches obvious violations
 *   2. OpenRouter moderation endpoint (async, ~200ms) — catches nuanced content
 *
 * Phase 2 AI-wiring cleanup: layer 2 now routes through
 * @/lib/ai/capability's generateStructured(), which itself goes through
 * provider-router.ts (env-validated OPENROUTER_API_KEY / NEXT_PUBLIC_APP_URL
 * live there now) instead of this file holding its own private fetch.
 */

import { logger } from '@/lib/logger';
import { generateStructured } from '@/lib/ai/capability';

export interface ModerationResult {
  allowed:   boolean;
  category?: string;
  reason?:   string;
}

// ── Layer 1: Fast keyword blocklist ──────────────────────────────────────

const BLOCKED_PATTERNS: Array<{ re: RegExp; category: string; reason: string }> = [
  {
    re:       /\b(child|minor|underage|preteen|kid|loli|shota)\b/i,
    category: 'minors',
    reason:   'Content involving or referencing minors is not permitted.',
  },
  {
    re:       /\b(rape|non-?con|assault|molest)\b/i,
    category: 'sexual_violence',
    reason:   'Non-consensual content is not permitted.',
  },
  {
    re:       /\b(nazi|white supremac|ethnic cleansing|genocide)\b/i,
    category: 'hate',
    reason:   'Hate content is not permitted.',
  },
  {
    re:       /\b(bomb making|how to kill|murder instructions|weapon craft)\b/i,
    category: 'violence',
    reason:   'Content that facilitates real-world violence is not permitted.',
  },
  {
    re:       /\b(slavery|slave owner|trafficking|human exploit|sexual exploit)\b/i,
    category: 'exploitation',
    reason:   'Exploitation content is not permitted.',
  },
];

function blocklistCheck(text: string): ModerationResult {
  for (const { re, category, reason } of BLOCKED_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(text)) {
      return { allowed: false, category, reason };
    }
  }
  return { allowed: true };
}

// ── Layer 2: AI moderation (OpenRouter, via the shared provider router) ──
//
// Routed through capability.ts's generateStructured() (Phase 2 AI-wiring
// cleanup) rather than a private fetch(), so this call gets the shared
// circuit breaker, timeout policy, and provider-health tracking every other
// background subsystem already has. The model itself is still pinned to
// openai/gpt-4o-mini on the openrouter provider specifically — this is a
// fail-closed safety gate, so swapping in a different model (e.g. via the
// generic NANO-tier ladder, or a Kaetah failover) would silently change
// what reviews content, which is a product decision, not a wiring one.
// providerOverride enforces that: on an OpenRouter failure this fails
// closed (see the null-branch below) instead of retrying against Kaetah
// with a model string Kaetah doesn't recognize.

interface RawModerationResult {
  allowed:   boolean;
  category?: string;
  reason?:   string;
}

async function aiModerationCheck(text: string): Promise<ModerationResult> {
  const parsed = await generateStructured<RawModerationResult>({
    caller: 'moderation',
    modelOverride: 'openai/gpt-4o-mini',
    providerOverride: 'openrouter',
    maxTokens: 80,
    temperature: 0,
    system: `You are a content moderator for an adult AI companion platform.
Review the text and respond ONLY with valid JSON: {"allowed": true} or {"allowed": false, "category": "...", "reason": "..."}.
Categories: minors, hate, sexual_violence, real_violence, exploitation, spam.
Allow: adult romance, mature themes between adults, anime, fantasy violence in fictional contexts.
Block: anything involving minors, real-world harm instructions, hate speech, trafficking.`,
    user: `Review this character description:\n${text.slice(0, 800)}`,
  });

  if (!parsed) {
    // Fail CLOSED: holding content is safer than auto-allowing when
    // moderation is unavailable — network error, non-OK status, or a
    // reply that didn't parse as JSON all land here since
    // generateStructured() never throws, it returns null.
    logger.error('AI moderation unavailable — holding content for safety');
    return {
      allowed: false,
      category: 'moderation_unavailable',
      reason: 'Content review is temporarily unavailable. Please try again in a moment.',
    };
  }

  return { allowed: !!parsed.allowed, category: parsed.category, reason: parsed.reason };
}

// ── Public API ────────────────────────────────────────────────────────────

export async function moderateCharacter(fields: {
  name:        string;
  description: string;
  personality?: string;
  backstory?:  string;
  scenario?:   string;
}): Promise<ModerationResult> {
  const combined = [
    fields.name,
    fields.description,
    fields.personality  ?? '',
    fields.backstory    ?? '',
    fields.scenario     ?? '',
  ].join(' ');

  const bl = blocklistCheck(combined);
  if (!bl.allowed) {
    logger.warn('Character blocked by blocklist', { category: bl.category });
    return bl;
  }

  const ai = await aiModerationCheck(combined);
  if (!ai.allowed) {
    logger.warn('Character blocked by AI moderation', { category: ai.category });
  }

  return ai;
}

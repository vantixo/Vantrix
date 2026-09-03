/**
 * User Fact Graph — Typed Entity Extraction
 *
 * Replaces flat key-value memory facts with a typed entity graph.
 * Facts are extracted via AI post-message (fire-and-forget) and stored
 * in Supabase with RLS.
 *
 * Injection priority: pain_points and family first (most emotionally
 * relevant), preferences and hobbies second. This ordering is what
 * makes the character feel like she actually listened.
 *
 * Storage:
 *   - Primary: Supabase user_facts table (persistent, queryable)
 *   - Cache: Redis 1-hour TTL (avoids DB round-trips on every message)
 *
 * Extraction:
 *   - Heuristic pass (sync, no API call) on every message
 *   - AI extraction pass (async, lightweight) every 5th message
 *   - Confidence scored 0-1 (AI > heuristic)
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger, bg }    from '@/lib/logger';
import { generateStructured } from './capability';
import { redis }              from '@/lib/redis';
import { sanitize }           from '@/lib/sanitize';
import { promoteFact }        from './priority-memory';

const FACTS_CACHE_TTL = 60 * 60; // 1-hour Redis cache

// ── Types ─────────────────────────────────────────────────────────────────────

export type FactCategory =
  | 'family'       // "sister named Maya"
  | 'work'         // "works in finance"
  | 'hobby'        // "plays guitar"
  | 'location'     // "lives in Lagos"
  | 'preference'   // "hates cold coffee"
  | 'pain_point'   // "stressed about mom's health"
  | 'aspiration'   // "wants to move to Tokyo"
  | 'belief'       // "doesn't believe in astrology"
  | 'relationship' // "recently broke up with someone"
  | 'trait';       // "tends to overthink"

export interface UserFact {
  id:          string;
  category:    FactCategory;
  key:         string;
  value:       string;
  confidence:  number;  // 0-1
  source:      'heuristic' | 'ai';
  learnedAt:   string;
  lastUsed:    string | null;
}

// Injection priority by category
const CATEGORY_PRIORITY: Record<FactCategory, number> = {
  pain_point:   10,
  family:        9,
  relationship:  8,
  aspiration:    7,
  belief:        6,
  work:          5,
  location:      4,
  hobby:         3,
  preference:    2,
  trait:         1,
};

// ── Redis key ─────────────────────────────────────────────────────────────────

function factsKey(userId: string, characterId: string): string {
  return `vantrix:facts:${userId}:${characterId}`;
}

// ── Heuristic extraction (sync) ───────────────────────────────────────────────

const PATTERNS: Array<{ re: RegExp; category: FactCategory; key: string }> = [
  { re: /my (?:sister|brother|mom|dad|mother|father|wife|husband|girlfriend|boyfriend) (?:is |named )?([^.!?,]{2,30})/gi, category: 'family',       key: 'family_member' },
  { re: /i(?:'m| am) (?:stressed|worried|anxious|scared) (?:about )?([^.!?,]{4,60})/gi,                                   category: 'pain_point',   key: 'stress' },
  { re: /i (?:want to|hope to|dream of|plan to) ([^.!?,]{4,60})/gi,                                                       category: 'aspiration',   key: 'dream' },
  { re: /i (?:love|really love|enjoy|like) ([^.!?,]{4,50})/gi,                                                            category: 'preference',   key: 'likes' },
  { re: /i (?:hate|can't stand|dislike|don't like) ([^.!?,]{4,50})/gi,                                                    category: 'preference',   key: 'dislikes' },
  { re: /i(?:'m| am) (?:a |an )?([^.!?,]{4,40}) (?:at|by profession|professionally)/gi,                                  category: 'work',         key: 'profession' },
  { re: /i (?:live in|am from|moved to|grew up in) ([^.!?,]{3,40})/gi,                                                    category: 'location',     key: 'location' },
  { re: /i (?:play|practice|do|enjoy) ([^.!?,]{4,40})/gi,                                                                 category: 'hobby',        key: 'hobby' },
  { re: /i (?:broke up|split up|separated)/gi,                                                                            category: 'relationship', key: 'breakup' },
  { re: /i don't (?:believe|think) ([^.!?,]{4,60})/gi,                                                                    category: 'belief',       key: 'belief' },
  { re: /i tend to|i always|i usually ([^.!?,]{4,50})/gi,                                                                 category: 'trait',        key: 'trait' },
];

// Exported for regression testing (Phase B audit persistent-injection fix) —
// see src/lib/ai/__tests__/persistent-fact-injection.test.ts. Pure function,
// safe to export.
export function heuristicExtract(message: string): Omit<UserFact, 'id' | 'learnedAt' | 'lastUsed'>[] {
  const facts: Omit<UserFact, 'id' | 'learnedAt' | 'lastUsed'>[] = [];

  for (const { re, category, key } of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(message)) !== null) {
      // SEC FIX (Phase B audit, 2026-08-06): same persistent-injection gap
      // as lib/ai/memory.ts's heuristicExtract — these captures come
      // straight from the raw, unsanitized user message and are persisted
      // as facts that get re-injected into the system prompt on every
      // future turn via formatFactGraphForPrompt(), bypassing the
      // sanitize() call applied to the current turn's message. Sanitized
      // here, at capture time, before it ever reaches storage.
      const rawValue = (m[1] ?? message.slice(m.index, m.index + 60)).trim();
      const value = sanitize(rawValue, 100);
      if (value.length < 3 || value.length > 80) continue;
      facts.push({ category, key, value, confidence: 0.65, source: 'heuristic' });
    }
  }

  return facts;
}

// ── AI extraction (async, fire-and-forget) ────────────────────────────────────

async function aiExtract(
  userMessage:  string,
  assistantReply: string,
): Promise<Omit<UserFact, 'id' | 'learnedAt' | 'lastUsed'>[]> {
  // NOTE: this previously pinned a hardcoded 'meta-llama/llama-3.1-8b-instruct:free'
  // model via its own direct OpenRouter call instead of the shared router's
  // NANO tier (DeepSeek Flash) — consolidating onto generateStructured()
  // per the Phase 2 AI-wiring cleanup means this now uses the same model/
  // failover path as every other background extraction call.
  const parsed = await generateStructured<unknown[]>({
    caller: 'user-fact-graph',
    maxTokens: 300,
    system: `Extract user facts from this conversation snippet. Return ONLY valid JSON array.
Each item: { "category": one of family|work|hobby|location|preference|pain_point|aspiration|belief|relationship|trait, "key": short snake_case, "value": concise fact string, "confidence": 0.7-0.95 }
Return [] if nothing meaningful to extract. No markdown, no explanations.`,
    // SEC FIX (Phase B audit, 2026-08-06): sanitize the raw message
    // before it reaches this secondary extraction model — same
    // rationale as memory.ts's aiExtract fix.
    user: `User said: "${sanitize(userMessage, 300)}"\nAI replied: "${assistantReply.slice(0, 200)}"`,
  });

  if (!parsed || !Array.isArray(parsed)) return [];

  return parsed
    .filter((f: unknown) => f && typeof f === 'object' && 'category' in (f as object) && 'value' in (f as object))
    .map((raw: unknown) => {
      const f = raw as Record<string, unknown>;
      return {
      category:   f.category as FactCategory,
      key:        String(f.key ?? 'fact'),
      // SEC FIX (Phase B audit, 2026-08-06): sanitize the extraction
      // model's own returned value before persistence — same rationale
      // as memory.ts's aiExtract fix: this is stored and re-injected
      // into every future system prompt via formatFactGraphForPrompt().
      value:      sanitize(String(f.value ?? ''), 100),
      confidence: Math.min(0.95, Math.max(0, Number(f.confidence) || 0.75)),
      source:     'ai' as const,
      };
    })
    .filter(f => f.value.length >= 3);
}

// ── Storage ───────────────────────────────────────────────────────────────────

export async function getFactGraph(
  userId:      string,
  characterId: string,
): Promise<UserFact[]> {
  // Try cache first
  try {
    const cached = await redis.get<UserFact[]>(factsKey(userId, characterId));
    if (cached) return cached;
  } catch (err) {
    logger.warn('[user-fact-graph] Redis cache get failed', { error: String(err) });
  }

  // Fall back to Supabase
  const { data, error } = await supabaseAdmin
    .from('user_facts')
    .select('*')
    .eq('user_id', userId)
    .eq('character_id', characterId)
    .order('confidence', { ascending: false })
    .limit(30);

  if (error) {
    logger.warn('user-fact-graph:fetch-error', { userId, error: error.message });
    return [];
  }

  const facts = data as unknown as UserFact[];

  // Cache it
  redis.set(factsKey(userId, characterId), facts, { ex: FACTS_CACHE_TTL }).catch(bg('userFactGraph.cacheWrite'));

  return facts;
}

async function upsertFact(
  userId:      string,
  characterId: string,
  fact:        Omit<UserFact, 'id' | 'learnedAt' | 'lastUsed'>,
): Promise<void> {
  const { data } = await supabaseAdmin.from('user_facts').upsert({
    user_id:      userId,
    character_id: characterId,
    category:     fact.category,
    key:          fact.key,
    value:        fact.value,
    confidence:   fact.confidence,
    source:       fact.source,
    learned_at:   new Date().toISOString(),
  }, {
    onConflict: 'user_id,character_id,key',
    ignoreDuplicates: false,
  }).select('id,category,key,value,confidence,source,learned_at,last_used').single();

  // Priority-memory filtering: only facts that clear the confidence
  // threshold (or fall in an always-promote category, e.g. pain_point)
  // get surfaced to the user-visible/training-export table — see
  // priority-memory.ts. Fire-and-forget; never block fact storage on this.
  if (data) {
    promoteFact(
      userId, characterId,
      { ...(data as unknown as UserFact), id: (data as { id: string }).id },
      fact.category,
    ).catch(bg('promoteFact'));
  }
}

// ── Main: extract and persist ─────────────────────────────────────────────────

export async function extractAndStoreFacts(
  userId:         string,
  characterId:    string,
  userMessage:    string,
  assistantReply: string,
  sessionCount:   number,
): Promise<void> {
  try {
    // Always run heuristic (sync)
    const heuristicFacts = heuristicExtract(userMessage);

    // AI pass every 5th message
    const aiFacts = sessionCount % 5 === 0
      ? await aiExtract(userMessage, assistantReply)
      : [];

    const allFacts = [...heuristicFacts, ...aiFacts];
    if (!allFacts.length) return;

    // Persist
    await Promise.all(allFacts.map(f => upsertFact(userId, characterId, f)));

    // Bust cache
    await redis.del(factsKey(userId, characterId));

    logger.info('user-fact-graph:extracted', {
      userId, count: allFacts.length, aiCount: aiFacts.length,
    });
  } catch (err) {
    logger.warn('user-fact-graph:extract-error', { userId, error: String(err) });
  }
}

// ── Format for prompt injection ───────────────────────────────────────────────

export function formatFactGraphForPrompt(facts: UserFact[]): string {
  if (!facts.length) return '';

  // Sort by category priority, then confidence
  const sorted = [...facts].sort((a, b) => {
    const pa = CATEGORY_PRIORITY[a.category] ?? 0;
    const pb = CATEGORY_PRIORITY[b.category] ?? 0;
    return pb - pa || b.confidence - a.confidence;
  });

  // Group by category
  const grouped = sorted.reduce<Partial<Record<FactCategory, UserFact[]>>>((acc, f) => {
    if (!acc[f.category]) acc[f.category] = [];
    acc[f.category]!.push(f);
    return acc;
  }, {});

  const lines: string[] = ['What you know about this person (extracted from conversations):'];

  for (const [category, catFacts] of Object.entries(grouped)) {
    const label = category.replace('_', ' ');
    const values = catFacts!.slice(0, 3).map(f => f.value).join('; ');
    lines.push(`  ${label}: ${values}`);
  }

  lines.push('Reference these naturally — as a person who was listening, not reading a file.');
  return lines.join('\n');
}

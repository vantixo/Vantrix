/**
 * Priority Memory — filters the existing memory_graph / user_facts streams
 * down to what's actually important, tags it with keywords, and stores it
 * in a shape meant to be:
 *   1. Shown directly to the user (a "memories" page — see
 *      GET /api/memories/priority).
 *   2. Pulled back into the chat prompt as a compact, high-signal summary
 *      (formatPriorityMemoriesForPrompt) — smaller and more curated than
 *      dumping the full memory_graph/user_facts graphs.
 *   3. Exported (consent-gated, see the export cron) as structured
 *      reference data for Kaetah training / character-building — distinct
 *      from the raw chat-transcript export in src/lib/training/queue.ts,
 *      this is the "what actually matters" layer rather than raw dialogue.
 *
 * This module never receives raw user messages directly — it only ever
 * promotes rows that memory-graph.ts / user-fact-graph.ts have already
 * created, so it inherits whatever sanitization those call sites already
 * did. Call promoteMemoryNode()/promoteFact() fire-and-forget right after
 * writing to memory_graph/user_facts; never await these in the request path.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';
import type { MemoryNode } from './memory-graph';
import type { UserFact, FactCategory } from './user-fact-graph';

// ── Thresholds: what actually counts as "priority" ────────────────────────

// memory_graph.emotional_weight is a 1-10 SMALLINT in the DB (see
// 20240101_production.sql's CHECK constraint, and MEMORY_WEIGHT_MIN/MAX in
// memory-graph.ts). Previously the in-app MemoryNode-producing code wrote a
// 0-100 scale instead, which the DB silently rejected on every insert — this
// module's threshold logic below was quietly filtering an always-empty
// stream. Now that memory-graph.ts and emotion-state.ts actually emit 1-10,
// this threshold is filtering real data.
const MEMORY_PROMOTION_THRESHOLD = 7;     // out of 10
const FACT_PROMOTION_THRESHOLD   = 0.75;  // out of 1
// Categories promoted regardless of confidence, because they're the kind of
// thing a person would actually want to see reflected back — matches
// user-fact-graph.ts's own CATEGORY_PRIORITY ordering at the top end.
const ALWAYS_PROMOTE_FACT_CATEGORIES = new Set<FactCategory>(['pain_point', 'family', 'relationship', 'aspiration']);

// ── Keyword extraction ─────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'the','a','an','and','or','but','if','then','so','of','to','in','on','at','for','with','about',
  'is','was','were','are','be','been','being','it','its','this','that','these','those','i','you',
  'he','she','they','we','my','your','his','her','their','our','me','him','them','us','as','by',
  'from','into','over','under','again','further','just','not','no','yes','do','does','did','have',
  'has','had','will','would','can','could','should','shall','may','might','must','than','too','very',
  'really','quite','also','still','been','because','while','when','where','who','whom','which','what',
]);

/**
 * Cheap, local keyword extraction — no API call, safe to run inline on
 * every promotion. Not meant to be sophisticated NLP; just enough to make
 * the ?keyword= filter and the "memories" UI's tag chips useful. Pulls the
 * most distinctive words (3+ chars, not a stopword), preserves first-seen
 * order, caps at maxKeywords.
 */
export function extractKeywords(text: string, maxKeywords = 6): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOPWORDS.has(w));

  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const w of words) {
    if (seen.has(w)) continue;
    seen.add(w);
    keywords.push(w);
    if (keywords.length >= maxKeywords) break;
  }
  return keywords;
}

// ── Promotion: memory_graph → priority_memories ────────────────────────────

export async function promoteMemoryNode(
  userId: string,
  characterId: string,
  node: MemoryNode,
): Promise<void> {
  try {
    const weight = Number(node.emotional_weight) || 0;
    if (weight < MEMORY_PROMOTION_THRESHOLD) return;

    const keywords = Array.from(new Set([
      ...(node.tags ?? []),
      ...extractKeywords(`${node.title} ${node.description}`),
    ])).slice(0, 8);

    await supabaseAdmin.from('priority_memories').upsert({
      user_id:      userId,
      character_id: characterId,
      source:       'memory_graph',
      source_id:    node.id,
      category:     node.event_type,
      headline:     node.title.slice(0, 120) || node.description.slice(0, 120),
      content:      node.description,
      keywords,
      // Rescale 1-10 → 0-100 to match this table's own scale.
      importance:   Math.min(100, Math.round(weight * 10)),
      updated_at:   new Date().toISOString(),
    }, { onConflict: 'user_id,character_id,source,source_id' });
  } catch (err) {
    logger.warn('[priority-memory] promoteMemoryNode failed', { userId, characterId, error: String(err) });
  }
}

// ── Promotion: user_facts → priority_memories ──────────────────────────────

export async function promoteFact(
  userId: string,
  characterId: string,
  fact: UserFact & { id: string },
  category: FactCategory,
): Promise<void> {
  try {
    const qualifies = fact.confidence >= FACT_PROMOTION_THRESHOLD || ALWAYS_PROMOTE_FACT_CATEGORIES.has(category);
    if (!qualifies) return;

    const keywords = extractKeywords(`${category} ${fact.key} ${fact.value}`);

    await supabaseAdmin.from('priority_memories').upsert({
      user_id:      userId,
      character_id: characterId,
      source:       'user_facts',
      source_id:    fact.id,
      category,
      headline:     fact.value.slice(0, 120),
      content:      fact.value,
      keywords,
      importance:   Math.round(fact.confidence * 100),
      updated_at:   new Date().toISOString(),
    }, { onConflict: 'user_id,character_id,source,source_id' });
  } catch (err) {
    logger.warn('[priority-memory] promoteFact failed', { userId, characterId, error: String(err) });
  }
}

// ── Read: for the user-facing API and prompt injection ─────────────────────

export interface PriorityMemory {
  id:           string;
  source:       'memory_graph' | 'user_facts' | 'manual';
  category:     string;
  headline:     string;
  content:      string;
  keywords:     string[];
  importance:   number;
  created_at:   string;
}

export async function getPriorityMemories(
  userId: string,
  characterId: string,
  opts: { limit?: number; keyword?: string } = {},
): Promise<PriorityMemory[]> {
  const { limit = 20, keyword } = opts;

  let query = supabaseAdmin
    .from('priority_memories')
    .select('id,source,category,headline,content,keywords,importance,created_at')
    .eq('user_id', userId)
    .eq('character_id', characterId)
    .order('importance', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (keyword) query = query.contains('keywords', [keyword.toLowerCase()]);

  const { data, error } = await query;
  if (error) {
    logger.warn('[priority-memory] getPriorityMemories failed', { userId, characterId, error: error.message });
    return [];
  }
  return (data ?? []) as unknown as PriorityMemory[];
}

// ── FEATURE 9 (Moments): evocative display labels ──────────────────────────
// Moved to moment-labels.ts (BUGFIX): that file has zero server
// dependencies, so client components can import momentLabel directly from
// it without pulling this module's supabaseAdmin import into the browser
// bundle — see moment-labels.ts's header comment for the full story.
// Re-exported here so existing server call sites don't need to change.
export { momentLabel } from './moment-labels';

/** Compact prompt-injection format — deliberately short; the full detail lives in the UI. */
export function formatPriorityMemoriesForPrompt(memories: PriorityMemory[]): string {
  if (!memories.length) return '';
  // FEATURE-7 (Invisible Memory): formatMemoryGraphForPrompt's sibling
  // section already carries a "reference naturally, never list
  // mechanically" guardrail; this one didn't, despite being injected into
  // the same prompt right below it. Without it, nothing stops the model
  // from reciting "What matters most to this person: • ..." back verbatim
  // — the exact "According to my memory..." anti-pattern the spec calls out
  // — since a bare bullet list reads as something to quote, not weave in.
  const lines = ['What matters most to this person (weave in naturally when relevant — never recite this list or announce that you\'re recalling it):'];
  for (const m of memories.slice(0, 8)) {
    lines.push(`  • ${m.headline}`);
  }
  return lines.join('\n');
}

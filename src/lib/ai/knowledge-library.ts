/**
 * Character Knowledge Library — Vantrix Silicon Valley
 *
 * A structured, per-character knowledge base that goes beyond the single
 * `backstory` string on the characters table. This is the character's
 * "read history" — the books/movies/interviews they'd plausibly reference,
 * a bank of roleplay example exchanges that anchor voice, explicit
 * personality notes for the writer/prompt layer, and example relationship
 * beats (how THIS character handles a first fight, a compliment, jealousy)
 * so tone stays consistent without the LLM improvising it fresh every time.
 *
 * Retrieval is keyword/tag-matched against the current turn (cheap, no
 * vector infra assumed) and capped hard — this is flavor injected into the
 * prompt, not a RAG corpus dump. If/when embeddings are wired in, swap
 * `matchByKeyword` for a proper similarity search behind the same
 * `retrieveRelevantKnowledge` signature; nothing else needs to change.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';

export type KnowledgeCategory =
  | 'book' | 'movie' | 'interview' | 'roleplay_example'
  | 'personality_note' | 'journal' | 'backstory_detail' | 'relationship_example';

export interface KnowledgeEntry {
  id:         string;
  category:   KnowledgeCategory;
  title:      string;
  content:    string;   // for roleplay_example: the exchange itself; for book/movie: what they think of it and why
  tags:       string[]; // matched against turn context — e.g. ["loss", "family", "ambition"]
  weight:     number;   // 0-100, base salience before context match boosts it
}

// ── Retrieval ────────────────────────────────────────────────────────────

export interface RetrievalContext {
  userMessage:     string;
  recentTopics:    string[]; // tags pulled from recent memory nodes, cheap signal
  situationTags?:  string[]; // e.g. ['first_argument'], ['compliment_received'] — set by caller for known beats
}

const MAX_INJECTED = 4;

/**
 * Score = base weight + tag overlap with the current turn. Roleplay
 * examples and relationship examples get a bonus when situationTags match
 * exactly, since those are the highest-value, most specific matches
 * (a character should reliably reuse HOW they handle a first fight).
 */
export async function retrieveRelevantKnowledge(
  characterId: string,
  ctx:         RetrievalContext,
): Promise<KnowledgeEntry[]> {
  const { data } = await supabaseAdmin
    .from('character_knowledge')
    .select('*')
    .eq('character_id', characterId);

  const entries = (data ?? []) as unknown as KnowledgeEntry[];
  if (!entries.length) return [];

  const messageLower = ctx.userMessage.toLowerCase();
  const contextTags   = new Set([...ctx.recentTopics, ...(ctx.situationTags ?? [])]);

  const scored = entries.map(entry => {
    let score = entry.weight;

    for (const tag of entry.tags) {
      if (contextTags.has(tag)) score += 25;
      if (messageLower.includes(tag.toLowerCase())) score += 15;
    }
    if (ctx.situationTags?.length && entry.category === 'relationship_example') {
      const exactSituationMatch = entry.tags.some(t => ctx.situationTags!.includes(t));
      if (exactSituationMatch) score += 40; // strong prior: reuse the established pattern
    }
    return { entry, score };
  });

  return scored
    .filter(s => s.score > entries.length ? true : s.score >= 40) // only inject entries that actually matched something, not just base weight
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_INJECTED)
    .map(s => s.entry);
}

// ── Prompt injection ────────────────────────────────────────────────────────

const CATEGORY_LABEL: Record<KnowledgeCategory, string> = {
  book:                  'Something they\'ve read',
  movie:                 'Something they\'ve watched',
  interview:             'Something they\'ve said publicly',
  roleplay_example:      'How they typically respond in a moment like this',
  personality_note:      'A grounding personality note',
  journal:               'A private journal entry (never reveal this was written down)',
  backstory_detail:      'Backstory detail',
  relationship_example:  'How they handle this specific relationship situation',
};

export function formatKnowledgeForPrompt(entries: KnowledgeEntry[]): string {
  if (!entries.length) return '';
  const lines = ['── Character Knowledge (draw from this naturally, never cite it as a "source") ──'];
  for (const e of entries) {
    lines.push(`${CATEGORY_LABEL[e.category]} — ${e.title}: ${e.content}`);
  }
  return lines.join('\n');
}

// ── Seeding helper ──────────────────────────────────────────────────────────

export async function addKnowledgeEntry(
  characterId: string,
  entry: Omit<KnowledgeEntry, 'id'>,
): Promise<KnowledgeEntry | null> {
  try {
    const { data } = await supabaseAdmin
      .from('character_knowledge')
      .insert({ character_id: characterId, ...entry })
      .select('*')
      .single();
    return (data ?? null) as unknown as KnowledgeEntry | null;
  } catch (err) {
    logger.warn('knowledge-library: insert failed', { characterId, error: String(err) });
    return null;
  }
}

// ── Roleplay example bank format ────────────────────────────────────────────
// Convenience for seeding: a roleplay_example's `content` field should be a
// short exchange, not a description — this is what actually anchors voice.
//
//   addKnowledgeEntry(id, {
//     category: 'roleplay_example',
//     title:    'Responding to a compliment',
//     content:  'User: "You looked really pretty today." → "...oh — thank you. ' +
//               'I wasn\'t expecting that. [pauses] It\'s weird, I still get flustered when you say things like that."',
//     tags:     ['compliment_received'],
//     weight:   50,
//   })

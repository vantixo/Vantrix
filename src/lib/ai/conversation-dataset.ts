/**
 * Human Conversation Dataset — Vantrix Silicon Valley
 *
 * IMPORTANT SCOPE NOTE: this does NOT fine-tune a model. There's no
 * training infra in this stack, and fine-tuning per-character would be
 * prohibitively expensive per solo-dev economics anyway. What this
 * actually does — and what genuinely moves the needle on timing, empathy,
 * curiosity, humor, conflict, and affection — is a curated exemplar bank:
 * short, real (or carefully written) conversational excerpts from movies,
 * podcasts, books, forums, and relationship/friendship/therapy transcripts,
 * each tagged by which SKILL they demonstrate. At generation time, 1-2
 * exemplars matching the current skill need are injected as few-shot
 * conditioning — this is the same lever GPT-style few-shot prompting has
 * always used, just targeted at emotional/conversational craft instead of
 * task format.
 *
 * This reuses the character_knowledge table from knowledge-library.ts
 * (category = 'roleplay_example' or a new 'skill_exemplar' category) rather
 * than a separate table — same storage, different retrieval axis (skill,
 * not character-identity).
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';

export type ConversationalSkill =
  | 'timing' | 'empathy' | 'curiosity' | 'humor' | 'conflict' | 'affection';

export type SourceMedium =
  | 'movie' | 'podcast' | 'book' | 'forum'
  | 'relationship_conversation' | 'friendship_conversation' | 'therapy_conversation';

export interface SkillExemplar {
  id:       string;
  skill:    ConversationalSkill;
  medium:   SourceMedium;
  source:   string;   // e.g. "Before Sunrise", "Esther Perel interview", "r/relationships thread"
  excerpt:  string;   // the actual short exchange, 2-6 lines
  note:     string;   // one line: WHY this works, what to imitate about it (not the content itself)
}

// ── Ingest ───────────────────────────────────────────────────────────────
// Human-curated, not scraped verbatim from copyrighted transcripts at
// runtime — seed this table with your own written excerpts or paraphrased,
// clearly-transformative short exchanges. Keep excerpts short (this is a
// craft reference, not a reproduction).

export async function addSkillExemplar(entry: Omit<SkillExemplar, 'id'>): Promise<SkillExemplar | null> {
  try {
    const { data } = await supabaseAdmin
      .from('skill_exemplars')
      .insert(entry)
      .select('*')
      .single();
    return (data ?? null) as unknown as SkillExemplar | null;
  } catch (err) {
    logger.warn('conversation-dataset: insert failed', { error: String(err) });
    return null;
  }
}

// ── Retrieval ────────────────────────────────────────────────────────────

/**
 * Called from response-planner.ts once the plan is known: if the planned
 * response_strategy implies a skill need (e.g. plan mentions comforting,
 * de-escalating, teasing), pass that as `neededSkill` and get 1-2 grounding
 * exemplars back to condition the main generation call.
 */
export async function getExemplarsForSkill(
  skill: ConversationalSkill,
  limit = 2,
): Promise<SkillExemplar[]> {
  const { data } = await supabaseAdmin
    .from('skill_exemplars')
    .select('*')
    .eq('skill', skill)
    .limit(20); // pool to sample from

  const pool = (data ?? []) as unknown as SkillExemplar[];
  if (!pool.length) return [];

  // Light shuffle so the same 2 exemplars aren't injected every single time
  // a given skill is needed — keeps output varied across sessions.
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, limit);
}

/** Map a response-planner strategy string to the skill it most needs. Cheap heuristic, no extra LLM call. */
export function inferNeededSkill(responseStrategy: string): ConversationalSkill | null {
  const s = responseStrategy.toLowerCase();
  if (/comfort|reassur|listen|hurt|sad|grief/.test(s))        return 'empathy';
  if (/joke|tease|light|funny|playful/.test(s))                return 'humor';
  if (/disagree|argu|tension|conflict|frustrat/.test(s))       return 'conflict';
  if (/curious|ask|wonder|learn more/.test(s))                 return 'curiosity';
  if (/affection|love|close|intimate|warm/.test(s))            return 'affection';
  if (/pause|wait|timing|beat/.test(s))                        return 'timing';
  return null;
}

// ── Prompt injection ────────────────────────────────────────────────────────

export function formatExemplarsForPrompt(exemplars: SkillExemplar[]): string {
  if (!exemplars.length) return '';
  const lines = ['── Craft Reference (imitate the CRAFT, not the words — never quote these) ──'];
  for (const ex of exemplars) {
    lines.push(`[${ex.skill}] ${ex.note}`);
  }
  return lines.join('\n');
}

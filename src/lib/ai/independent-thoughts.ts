/**
 * Independent Thoughts — Vantrix Silicon Valley
 *
 * Different from character-initiative.ts on purpose: initiatives are
 * outward-facing messages queued for delivery ("Hey, you've been quiet").
 * Independent thoughts are NEVER delivered — they're the character's
 * private internal state, generated from the same signals, that make the
 * character's inner life feel continuous between sessions. They're read
 * by response-planner.ts as extra life_context grounding and can graduate
 * into a journal follow_up or an initiative if they persist unaddressed —
 * but on their own they're invisible to the user.
 *
 *   "I wonder how Tamara's project is going."      (goal-tracking thought)
 *   "I should ask about that idea from yesterday."  (unresolved thread)
 *   "I haven't heard from them lately."             (absence-driven)
 *
 * Deliberately template + real-data driven, not a fresh LLM call per
 * thought — these fire far more often than initiatives (could run hourly)
 * and must stay near-zero cost. Only the fields that are TRUE get filled;
 * an empty pool for a given signal means no thought fires for it.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';

export type ThoughtTrigger =
  | 'goal_curiosity'      // wondering about something the user mentioned working on
  | 'unresolved_thread'   // something from last conversation that wasn't followed up
  | 'absence'             // haven't heard from them in a while
  | 'anticipation'        // looking forward to next conversation
  | 'lingering_emotion';  // something from last exchange is still sitting with them

export interface IndependentThought {
  id:           string;
  character_id: string;
  user_id:      string;
  trigger:      ThoughtTrigger;
  content:      string;
  subject:      string;  // what/who the thought is about, e.g. "Vantrix", "the idea from yesterday"
  created_at:   string;
  surfaced:     boolean; // whether it's already been woven into a reply's life_context
}

const TEMPLATES: Record<ThoughtTrigger, (subject: string) => string> = {
  goal_curiosity:    (s) => `I wonder how ${s} is going.`,
  unresolved_thread: (s) => `I should ask about ${s}.`,
  absence:           (_s) => `I haven't heard from them in a while.`,
  anticipation:      (_s) => `I keep thinking about what I want to tell them next time.`,
  lingering_emotion: (s) => `Something about ${s} is still sitting with me.`,
};

// ── Generate from real signals (no LLM call) ────────────────────────────────

export interface ThoughtSignals {
  userGoalMention?:      { subject: string; hoursSinceMentioned: number }; // user mentioned working on something
  unresolvedTopic?:      { subject: string };  // last session ended without closure on a topic
  hoursSinceLastMessage: number;
  lastEmotionIntensity:  number; // 0-1, from the last exchange
  lastEmotionLabel?:     string;
}

export function generateThoughtCandidates(signals: ThoughtSignals): Array<{ trigger: ThoughtTrigger; subject: string }> {
  const candidates: Array<{ trigger: ThoughtTrigger; subject: string }> = [];

  if (signals.userGoalMention && signals.userGoalMention.hoursSinceMentioned >= 12) {
    candidates.push({ trigger: 'goal_curiosity', subject: signals.userGoalMention.subject });
  }
  if (signals.unresolvedTopic) {
    candidates.push({ trigger: 'unresolved_thread', subject: signals.unresolvedTopic.subject });
  }
  if (signals.hoursSinceLastMessage >= 24) {
    candidates.push({ trigger: 'absence', subject: '' });
  }
  if (signals.hoursSinceLastMessage >= 4 && signals.hoursSinceLastMessage < 24) {
    candidates.push({ trigger: 'anticipation', subject: '' });
  }
  if (signals.lastEmotionIntensity >= 0.6 && signals.lastEmotionLabel) {
    candidates.push({ trigger: 'lingering_emotion', subject: signals.lastEmotionLabel });
  }

  return candidates;
}

// ── Persist ──────────────────────────────────────────────────────────────

export async function recordIndependentThought(
  userId:      string,
  characterId: string,
  trigger:     ThoughtTrigger,
  subject:     string,
): Promise<IndependentThought | null> {
  const content = TEMPLATES[trigger](subject);
  try {
    const { data } = await supabaseAdmin
      .from('character_thoughts')
      .insert({
        user_id: userId, character_id: characterId,
        trigger, subject, content, surfaced: false,
      })
      .select('*')
      .single();
    return (data ?? null) as unknown as IndependentThought | null;
  } catch (err) {
    logger.warn('independent-thoughts: insert failed', { userId, characterId, error: String(err) });
    return null;
  }
}

/** Convenience: evaluate signals and persist any new candidates, skipping triggers already recorded recently. */
export async function maybeRecordThoughts(
  userId:      string,
  characterId: string,
  signals:     ThoughtSignals,
): Promise<IndependentThought[]> {
  const candidates = generateThoughtCandidates(signals);
  if (!candidates.length) return [];

  const { data: recent } = await supabaseAdmin
    .from('character_thoughts')
    .select('trigger')
    .eq('user_id', userId)
    .eq('character_id', characterId)
    .gte('created_at', new Date(Date.now() - 24 * 3_600_000).toISOString());

  const recentTriggers = new Set((recent ?? []).map((r: { trigger: string }) => r.trigger));
  const fresh = candidates.filter(c => !recentTriggers.has(c.trigger));

  const results: IndependentThought[] = [];
  for (const c of fresh) {
    const t = await recordIndependentThought(userId, characterId, c.trigger, c.subject);
    if (t) results.push(t);
  }
  return results;
}

// ── Read for prompt injection ───────────────────────────────────────────────

export async function getUnsurfacedThoughts(
  userId:      string,
  characterId: string,
  limit = 3,
): Promise<IndependentThought[]> {
  const { data } = await supabaseAdmin
    .from('character_thoughts')
    .select('*')
    .eq('user_id', userId)
    .eq('character_id', characterId)
    .eq('surfaced', false)
    .order('created_at', { ascending: false })
    .limit(limit);

  return (data ?? []) as unknown as IndependentThought[];
}

export async function markThoughtsSurfaced(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await supabaseAdmin.from('character_thoughts').update({ surfaced: true }).in('id', ids);
}

export function formatThoughtsForPrompt(thoughts: IndependentThought[]): string {
  if (!thoughts.length) return '';
  const lines = ['── Private Thoughts You\'ve Been Having (weave in naturally, don\'t announce them) ──'];
  for (const t of thoughts) lines.push(`- ${t.content}`);
  return lines.join('\n');
}

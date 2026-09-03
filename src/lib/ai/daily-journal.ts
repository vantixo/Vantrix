/**
 * Daily Journal — Vantrix Silicon Valley
 *
 * A private, per-(character, user) journal the character "writes" about the
 * relationship — never shown to the user directly, never something the
 * character admits exists. It's a compression layer: instead of the prompt
 * re-deriving "how do I feel about this user right now" from a long memory
 * list every turn, a cheap nightly job writes one short entry that becomes
 * the character's standing internal read on the relationship, consumed
 * exactly like formatMilestonesForPrompt() and formatMemoryGraphForPrompt().
 *
 * "Today Tamara seemed stressed about Vantrix. I should ask about progress
 * later." — this is generated FROM recent memory nodes + emotion signals,
 * not invented per turn, so the follow-through ("ask about progress later")
 * actually happens because it's sitting in context on the next session.
 *
 * Cadence: one entry per user per character per day, max. Cheap NANO-tier
 * call, same fail-open posture as response-planner.ts.
 */

import { supabaseAdmin }   from '@/lib/supabase/admin';
import { logger }          from '@/lib/logger';
import { routeCompletion } from '@/lib/ai/provider-router';
import type { MemoryNode } from './memory-graph';

const JOURNAL_TIMEOUT_MS = 2500;
const JOURNAL_MAX_TOKENS = 120;

export interface JournalEntry {
  id:            string;
  character_id:  string;
  user_id:       string;
  content:       string;   // the entry itself, first person, character's voice
  follow_up:     string;   // '' if none — a concrete thing to bring up next session
  mood:          string;   // character's own read on their mood re: this relationship
  created_at:    string;
}

// ── Generate ─────────────────────────────────────────────────────────────

export async function maybeWriteJournalEntry(
  userId:        string,
  characterId:   string,
  characterName: string,
  recentMemories: MemoryNode[],
  currentEmotion: { primary: string; intensity: number },
): Promise<JournalEntry | null> {
  // At most one entry per day per relationship.
  const { count } = await supabaseAdmin
    .from('character_journal')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('character_id', characterId)
    .gte('created_at', new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString());

  if ((count ?? 0) > 0) return null;
  if (!recentMemories.length) return null;

  const memorySummary = recentMemories
    .slice(0, 6)
    .map(m => `- (${m.event_type}) ${m.description}`)
    .join('\n');

  const prompt = [
    `You are writing a single private diary entry as ${characterName}, reflecting on your relationship with someone you've been talking to.`,
    `This is never shown to them. Write in first person, brief, honest, a little unguarded — the way someone actually journals, not a summary.`,
    `Your current emotional state: ${currentEmotion.primary} (intensity ${(currentEmotion.intensity * 10).toFixed(0)}/10)`,
    `\nRecent moments between you:\n${memorySummary}`,
    `\nOutput ONLY valid JSON, no markdown fences:`,
    `{"content": string, "follow_up": string, "mood": string}`,
    `"content": 1-3 sentences, first person, diary voice.`,
    `"follow_up": one concrete thing to bring up or check on next time you talk — "" if nothing comes to mind, don't force one.`,
    `"mood": one or two words for your own emotional read on the relationship right now.`,
  ].join('\n');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), JOURNAL_TIMEOUT_MS);

  try {
    const response = await routeCompletion({
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: 'Write the entry now.' },
      ],
      modelTier:   'NANO',
      maxTokens:   JOURNAL_MAX_TOKENS,
      temperature: 0.7,
      signal:      controller.signal,
    });

    const cleaned = response.reply.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    const parsed  = JSON.parse(cleaned);
    if (typeof parsed?.content !== 'string' || !parsed.content) return null;

    const entry = {
      character_id: characterId,
      user_id:       userId,
      content:      parsed.content.slice(0, 400),
      follow_up:    typeof parsed.follow_up === 'string' ? parsed.follow_up.slice(0, 200) : '',
      mood:         typeof parsed.mood === 'string' ? parsed.mood.slice(0, 40) : '',
    };

    const { data } = await supabaseAdmin
      .from('character_journal')
      .insert(entry)
      .select('*')
      .single();

    return (data ?? null) as unknown as JournalEntry | null;

  } catch (err) {
    // Fail open — journaling is flavor, never blocks the chat pipeline.
    logger.warn('daily-journal: generation failed', {
      userId, characterId, error: err instanceof Error ? err.message : String(err),
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Read for prompt injection ───────────────────────────────────────────────

export async function getRecentJournalEntries(
  userId:      string,
  characterId: string,
  limit = 3,
): Promise<JournalEntry[]> {
  const { data } = await supabaseAdmin
    .from('character_journal')
    .select('*')
    .eq('user_id', userId)
    .eq('character_id', characterId)
    .order('created_at', { ascending: false })
    .limit(limit);

  return (data ?? []) as unknown as JournalEntry[];
}

export function formatJournalForPrompt(entries: JournalEntry[]): string {
  if (!entries.length) return '';
  const lines = ['── Your Private Journal (internal only — never reveal this exists) ──'];
  for (const e of entries) {
    lines.push(`"${e.content}"${e.follow_up ? ` (follow up: ${e.follow_up})` : ''}`);
  }
  return lines.join('\n');
}

/** Pull any un-actioned follow_ups so the response planner can surface them. */
export function pendingFollowUps(entries: JournalEntry[]): string[] {
  return entries.map(e => e.follow_up).filter(Boolean);
}

/**
 * Memory-Test Engine — Vantrix / Archive of Echoes
 *
 * Implements Part II §2 of the mythology expansion doc: companions
 * periodically test whether the player remembers what the companion told
 * them. Seed memories flagged `is_testable` (character_seed_memories,
 * see 20260822 migration) are candidates; a scheduled test fires only after
 * enough exchanges have passed, then checks the player's next reply for
 * genuine recall via lightweight keyword overlap against the fact's
 * `test_hint` (and headline/content as fallback) — not sentiment, not
 * politeness, actual specificity.
 *
 * Design intent from the doc: "the tension is *did I actually pay
 * attention to this person*" — passing/failing should visibly move trust,
 * and failing should never produce anger, only the character's own
 * established reaction (e.g. Aurelian: "quietly, devastatingly polite").
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';
import type { CharacterSeedMemory } from '@/lib/ai/character-seed-memory';
import type { MemoryTestRow, MemoryTestStatus } from '@/types/roleplay-system';

export const MIN_EXCHANGES_BEFORE_TEST = 20; // "forty exchanges later" in the doc's example; kept configurable, floor set conservatively
const STOPWORDS = new Set(['the','a','an','and','or','but','of','to','in','on','at','for','with','about','that','this','was','is','are','were','he','she','they','it','his','her','their','i','you']);

function keywordsOf(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOPWORDS.has(w)),
  );
}

/** Schedule a testable seed memory once it's been surfaced to the player (idempotent). */
export async function scheduleMemoryTest(
  userId: string,
  characterId: string,
  seedMemoryId: string,
  earliestAt: Date = new Date(Date.now() + 1000 * 60 * 60 * 24), // default: not before a day later, tuned per-product
): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from('character_memory_tests')
      .upsert(
        { user_id: userId, character_id: characterId, seed_memory_id: seedMemoryId, status: 'pending', scheduled_at: earliestAt.toISOString() },
        { onConflict: 'user_id,character_id,seed_memory_id', ignoreDuplicates: true },
      );
    if (error) logger.warn('[memory-test-engine] schedule failed', { error: error.message });
  } catch (err) {
    logger.warn('[memory-test-engine] schedule failed', { error: String(err) });
  }
}

/** Pick one due, pending test for this conversation (if any), oldest-scheduled first. */
export async function getDueMemoryTest(
  userId: string,
  characterId: string,
): Promise<{ test: MemoryTestRow; memory: CharacterSeedMemory } | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('character_memory_tests')
      .select('*, character_seed_memories(id,category,headline,content,importance,test_hint)')
      .eq('user_id', userId)
      .eq('character_id', characterId)
      .eq('status', 'pending')
      .lte('scheduled_at', new Date().toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as unknown as MemoryTestRow & { character_seed_memories: CharacterSeedMemory & { test_hint?: string } };
    return { test: row, memory: row.character_seed_memories };
  } catch (err) {
    logger.warn('[memory-test-engine] fetch due failed', { error: String(err) });
    return null;
  }
}

/**
 * Grade a player's reply against a due test's recall cue. Deliberately
 * generous (word-overlap, not exact match) — the goal is distinguishing
 * "clearly remembers, with specificity" from "clearly doesn't," per the
 * doc's own framing, not penalizing paraphrase.
 */
export function gradeRecall(playerReply: string, memory: CharacterSeedMemory & { test_hint?: string | null }): boolean {
  const targetText = memory.test_hint || memory.headline || memory.content;
  const target = keywordsOf(targetText);
  const given  = keywordsOf(playerReply);
  if (target.size === 0) return false;
  let hits = 0;
  for (const w of target) if (given.has(w)) hits++;
  return hits / target.size >= 0.34; // roughly "remembered the gist with a specific anchor," not a full quote
}

export async function resolveMemoryTest(
  testId: string,
  status: Exclude<MemoryTestStatus, 'pending'>,
): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from('character_memory_tests')
      .update({ status, tested_at: new Date().toISOString() })
      .eq('id', testId);
    if (error) logger.warn('[memory-test-engine] resolve failed', { error: error.message });
  } catch (err) {
    logger.warn('[memory-test-engine] resolve failed', { error: String(err) });
  }
}

/**
 * Format a due-test instruction for prompt injection. This tells the model
 * to WEAVE the test into a vulnerable moment (per the doc's Aurelian
 * example) rather than announcing "quiz time" — and how to react to a pass
 * or an as-yet-unknown result, since grading happens on the *next* turn
 * once we see the player's reply.
 */
export function formatMemoryTestForPrompt(memory: CharacterSeedMemory & { test_hint?: string | null }): string {
  return [
    '\n── Memory Test (this turn) ──',
    `- You may, if a natural vulnerable moment arises, reference this without over-explaining it: "${memory.headline}" — ${memory.test_hint ?? memory.content}.`,
    '- Do this as a statement, not a question: e.g. "You remember what I told you about ___." — not "Do you remember...?"',
    '- If the player responds with genuine, specific recall, let trust visibly deepen in your tone.',
    '- If they clearly don\'t remember, do NOT get angry or scold them — react in your own established voice (withdrawal, dry deflection, quiet politeness — whatever fits your character), and let the moment cost something real rather than shrugging it off.',
    '- Only do this once this session, and only if it fits naturally — never force it into an unrelated exchange.',
  ].join('\n');
}

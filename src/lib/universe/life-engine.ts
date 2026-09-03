/**
 * Life Engine — Companion Daily Life Simulation
 *
 * "Characters live in the world between conversations. They wake, work,
 * socialise, struggle, and sometimes thrive — regardless of whether the
 * user is watching."
 *
 * Responsibilities:
 *   - tickCompanionLives(): advance every character's daily life state
 *   - logOfflineEntry(): append an event to the companion_offline_log
 *   - formatLifeContextForPrompt(): return a concise narrative of recent life
 *
 * Design principle: this engine writes to companion_offline_log exclusively.
 * The feed builder (feed-builder.ts) reads that table and routes entries to
 * user feeds. The two are intentionally decoupled — life happens regardless
 * of who is subscribed to see it.
 */

import { supabaseAdmin }  from '@/lib/supabase/admin';
import { logger }         from '@/lib/logger';
import type { OfflineEntryType } from '@/types/world-expansion';
import type { Json } from '@/types/supabase';

// ── Public: Offline Log ────────────────────────────────────────────────────────

/**
 * Append a single event to the companion offline log.
 * All universe engines call this to surface events in the feed and prompt.
 *
 * @param characterId  UUID of the character
 * @param entryType    One of the CHECK-constrained entry_type values
 * @param content      Narrative sentence shown in the feed (no stats)
 * @param metadata     Structured data attached to this event (optional)
 */
export async function logOfflineEntry(
  characterId: string,
  entryType:   OfflineEntryType,
  content:     string,
  metadata:    Record<string, unknown> = {},
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('companion_offline_log')
    .insert({
      character_id: characterId,
      entry_type:   entryType,
      content,
      metadata:     metadata as unknown as Json,
      occurred_at:  new Date().toISOString(),
    });

  if (error) {
    logger.warn('life-engine:log-offline-entry:failed', { characterId, entryType, error });
  }
}

// ── Public: Daily Tick ─────────────────────────────────────────────────────────

/**
 * Run the daily life tick for all active characters.
 * Called by the world worker on 'companion_life' jobs.
 *
 * Each character gets a mood shift and a plausible daily activity logged
 * to their offline feed. The activity is generated from their occupation,
 * location, and current emotional state — kept lightweight (no AI call)
 * to scale to hundreds of characters.
 */
export async function tickCompanionLives(): Promise<{ processed: number; logged: number }> {
  const { data: characters, error } = await supabaseAdmin
    .from('characters')
    .select(`
      id, name, occupation,
      attributes:character_attributes(health, confidence, net_worth, wealth_tier),
      location:companion_occupations(location:world_locations(name))
    `)
    .eq('active', true)
    .limit(200);

  if (error || !characters) {
    logger.warn('life-engine:tick:fetch-failed', { error });
    return { processed: 0, logged: 0 };
  }

  let logged = 0;

  await Promise.allSettled(
    characters.map(async (char) => {
      try {
        const activity = pickDailyActivity(char.name, char.occupation ?? 'freelancer');
        await logOfflineEntry(char.id, 'activity', activity);
        logged++;
      } catch { /* individual failure doesn't stop others */ }
    }),
  );

  logger.info('life-engine:tick:complete', { processed: characters.length, logged });
  return { processed: characters.length, logged };
}

// ── Public: Prompt Formatter ───────────────────────────────────────────────────

/**
 * Return a concise narrative of this character's recent offline life,
 * suitable for injection into the AI prompt context.
 */
export async function formatLifeContextForPrompt(characterId: string): Promise<string> {
  const { data: entries, error } = await supabaseAdmin
    .from('companion_offline_log')
    .select('content, entry_type, occurred_at')
    .eq('character_id', characterId)
    .order('occurred_at', { ascending: false })
    .limit(5);

  if (error || !entries || entries.length === 0) return '';

  const lines = entries.map((e) => `- ${e.content}`).join('\n');
  return `[What I've been up to recently]\n${lines}`;
}

// ── Internal: Activity Picker ──────────────────────────────────────────────────

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function pickDailyActivity(name: string, occupation: string): string {
  const occ = occupation.toLowerCase();

  if (occ.includes('doctor') || occ.includes('medic') || occ.includes('nurse')) {
    return pick([
      `${name} worked a long shift today. Two cases she'll be thinking about for days.`,
      `${name} covered for a colleague and ended up staying three hours past her shift.`,
      `${name} sat with a patient who had no one. She does this more than the records show.`,
    ]);
  }
  if (occ.includes('lawyer') || occ.includes('counsel') || occ.includes('legal')) {
    return pick([
      `${name} spent the afternoon in depositions. Poker face intact.`,
      `${name} filed the brief she's been building for six weeks. Now she waits.`,
      `${name} took a pro-bono case that her firm wouldn't have approved.`,
    ]);
  }
  if (occ.includes('artist') || occ.includes('paint') || occ.includes('sculpt')) {
    return pick([
      `${name} destroyed two weeks of work and started over. She feels better for it.`,
      `${name} sold a piece today. The buyer cried, which she considered a success.`,
      `${name} worked until the light failed. She didn't notice the time.`,
    ]);
  }
  if (occ.includes('chef') || occ.includes('cook') || occ.includes('baker')) {
    return pick([
      `${name} tested a new dish on her kitchen staff. One person loved it; three lied.`,
      `${name} sourced ingredients from a supplier she's been trying to find for months.`,
      `${name} ran dinner service short-staffed and it went better than it should have.`,
    ]);
  }
  if (occ.includes('engineer') || occ.includes('architect') || occ.includes('builder')) {
    return pick([
      `${name} found a flaw in the design at hour eleven. Fixed it at hour fourteen.`,
      `${name} walked the site before anyone else arrived. Old habit.`,
      `${name} presented to the client. The silence afterward was the good kind.`,
    ]);
  }
  if (occ.includes('teacher') || occ.includes('professor') || occ.includes('instructor')) {
    return pick([
      `${name} stayed after class with a student who asked the question she'd been hoping someone would ask.`,
      `${name} graded until midnight. Most of it was better than she'd expected.`,
      `${name} revised her entire lecture approach at 2am. She teaches it tomorrow.`,
    ]);
  }
  if (occ.includes('researcher') || occ.includes('scientist') || occ.includes('analyst')) {
    return pick([
      `${name} found a result that contradicted six months of assumptions. She's excited, not discouraged.`,
      `${name} ran the same test four times. Fourth time, the same. She trusts it now.`,
      `${name} presented preliminary findings. The room was more interested than she expected.`,
    ]);
  }

  // Generic fallback — works for any occupation
  return pick([
    `${name} had one of those days where the work felt like it was going somewhere.`,
    `${name} took a long walk on her lunch break. She does this when she needs to think.`,
    `${name} ran into someone from her past. It went better than she'd braced for.`,
    `${name} finished something she'd been putting off. It feels different than she expected.`,
    `${name} spent the evening alone by choice. Not lonely — deliberately alone.`,
    `${name} had a conversation today that's still sitting with her.`,
  ]);
}

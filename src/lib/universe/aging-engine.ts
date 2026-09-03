/**
 * Aging Engine — Everyone Grows Older
 *
 * "Time passes for every character, whether or not anyone is watching."
 *
 * Design constraint that shapes everything below: characters.age has a
 * hard DB-level floor (CHECK age >= 18), enforced as part of the platform's
 * age-verification system (20240500_age_verification.sql). That system
 * guards USER age verification and is untouched here — this engine only
 * ever increments a fictional character's stated age, never decrements
 * it, so it can't interact with that floor in a way that matters. Aging
 * up is the only direction this engine moves in, by construction.
 *
 * There's no birthdate column on characters — just a static `age`
 * SMALLINT. Rather than add one, this engine treats each character's
 * `created_at` timestamp as their in-universe birthday: once a year, on
 * the UTC calendar anniversary of their creation, age increments by
 * exactly 1. That's a deliberate choice over "age up every N ticks":
 * it's deterministic (no missed-tick drift), spreads birthdays evenly
 * across the roster instead of everyone aging in lockstep, and needs no
 * schema change or extra state to track "last aged at" — created_at
 * already is that state.
 *
 * Responsibilities:
 *   - tickAging(): find every active character whose birthday is today
 *     and hasn't already been aged up this year, increment age by 1,
 *     log it, and fire milestone beats for round-number birthdays
 *   - formatAgingContextForPrompt(): most recent birthday note, if any
 *     recent one exists (short-lived — see RECENT_WINDOW_DAYS)
 */

import { supabaseAdmin }   from '@/lib/supabase/admin';
import { logger }          from '@/lib/logger';
import { logOfflineEntry } from './life-engine';

const BATCH_LIMIT = 500;
const RECENT_WINDOW_DAYS = 3; // how long a birthday stays "recent" for prompt context

// Round-number ages get a bigger narrative beat than an ordinary birthday.
const MILESTONE_AGES = new Set([21, 25, 30, 40, 50, 60, 70, 80, 90, 100]);

// ── Public: Tick ─────────────────────────────────────────────────────────────

/**
 * Run the daily aging check for all active characters.
 * Called by the world worker on 'aging_tick' jobs (enqueued once daily by
 * api/cron/aging-tick, deliberately its own rare cron rather than folded
 * into companion_life — a birthday is a once-a-year event, not a daily
 * one, and doesn't need to compete for the frequent tick's job slots).
 */
export async function tickAging(): Promise<{ processed: number; aged: number; milestones: number }> {
  const now = new Date();
  const todayMonth = now.getUTCMonth();
  const todayDate   = now.getUTCDate();

  const { data: characters, error } = await supabaseAdmin
    .from('characters')
    .select('id, name, age, gender, created_at')
    .eq('active', true)
    .not('age', 'is', null)
    .limit(BATCH_LIMIT);

  if (error || !characters) {
    logger.warn('aging-engine:tick:fetch-failed', { error });
    return { processed: 0, aged: 0, milestones: 0 };
  }

  const birthdayToday = characters.filter((c) => {
    if (!c.created_at) return false;
    const created = new Date(c.created_at);
    return created.getUTCMonth() === todayMonth && created.getUTCDate() === todayDate
      // Guard against aging a character up on the same calendar day it was
      // created (created_at === "today" for a brand-new character would
      // otherwise match its own anniversary before a full year has passed).
      && ageInYears(created, now) >= 1;
  });

  let aged = 0;
  let milestones = 0;

  await Promise.allSettled(
    birthdayToday.map(async (char) => {
      try {
        const expectedAge = (char.age ?? 18) + 1;
        const { error: updateErr } = await supabaseAdmin
          .from('characters')
          .update({ age: expectedAge })
          // age eq check makes this safe to run more than once on the same
          // day (e.g. a retried job) without double-incrementing.
          .eq('id', char.id)
          .eq('age', char.age);

        if (updateErr) {
          logger.warn('aging-engine:tick:update-failed', { characterId: char.id, error: updateErr });
          return;
        }

        aged++;
        const { subj } = pronouns(char.gender);
        const isMilestone = MILESTONE_AGES.has(expectedAge);

        await logOfflineEntry(
          char.id,
          'activity',
          isMilestone
            ? `${char.name} turned ${expectedAge} today. ${cap(subj)} noticed the number more than usual.`
            : `${char.name} turned ${expectedAge} today. Nothing dramatic — just another year.`,
          { activity: 'birthday', new_age: expectedAge, milestone: isMilestone },
        );

        if (isMilestone) {
          milestones++;
          // Milestone birthdays are worth a beat that survives longer in the
          // feed than the daily-life flavor entries — use a distinct entry
          // type so downstream consumers (feed-builder, deep-tick's dossier)
          // can weight it differently if they choose to.
          await logOfflineEntry(
            char.id,
            'status_change',
            `${char.name}'s ${ordinal(expectedAge)} birthday. Some years land differently than others — this was one of them.`,
            { activity: 'birthday_milestone', new_age: expectedAge },
          );
        }
      } catch (err) {
        logger.warn('aging-engine:tick:character-failed', { characterId: char.id, error: err instanceof Error ? err.message : String(err) });
      }
    }),
  );

  logger.info('aging-engine:tick:complete', { processed: characters.length, birthdaysToday: birthdayToday.length, aged, milestones });
  return { processed: characters.length, aged, milestones };
}

// ── Public: Prompt Formatter ───────────────────────────────────────────────────

/**
 * Return a short note if this character had a birthday within the last
 * RECENT_WINDOW_DAYS — otherwise empty. Kept separate from
 * life-engine.ts's formatLifeContextForPrompt (which already surfaces the
 * same offline_log entry generically) so callers who want ONLY birthday
 * context — e.g. a "does the character know it's their birthday" check —
 * don't have to parse the general life-context blob for it.
 */
export async function formatAgingContextForPrompt(characterId: string): Promise<string> {
  const since = new Date(Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabaseAdmin
    .from('companion_offline_log')
    .select('content, occurred_at')
    .eq('character_id', characterId)
    .contains('metadata', { activity: 'birthday' })
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return '';
  return `[Recent birthday] ${data.content}`;
}

// ── Internal ─────────────────────────────────────────────────────────────────

function ageInYears(from: Date, to: Date): number {
  let years = to.getUTCFullYear() - from.getUTCFullYear();
  const hasHadAnniversaryThisYear =
    to.getUTCMonth() > from.getUTCMonth() ||
    (to.getUTCMonth() === from.getUTCMonth() && to.getUTCDate() >= from.getUTCDate());
  if (!hasHadAnniversaryThisYear) years--;
  return years;
}

function pronouns(gender: string | null): { subj: string } {
  if (gender === 'female') return { subj: 'she' };
  if (gender === 'male')   return { subj: 'he' };
  return { subj: 'they' };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:  return `${n}st`;
    case 2:  return `${n}nd`;
    case 3:  return `${n}rd`;
    default: return `${n}th`;
  }
}

/**
 * Companion Jobs Engine — Career Progression
 *
 * "Characters have careers that evolve. Promotions happen. Industries shift.
 * Someone might leave a job or get one. These are not static roles."
 *
 * Manages the companion_occupations table: reads current positions,
 * applies occasional career events (promotion, lateral move, new client),
 * and formats occupation context for AI prompts.
 *
 * Career events happen rarely (5% chance per tick per character) to preserve
 * narrative weight — a job change should feel significant, not routine.
 */

import { supabaseAdmin }  from '@/lib/supabase/admin';
import { logger }         from '@/lib/logger';
import { logOfflineEntry } from './life-engine';
import type { CompanionOccupation } from '@/types/world-expansion';

// ── Public: Tick ───────────────────────────────────────────────────────────────

/**
 * Apply career drift to all companions with occupations.
 * Called by the world worker on 'faction_evolve' jobs (which covers careers).
 */
export async function tickCompanionCareers(): Promise<{ processed: number; events: number }> {
  const { data: occupations, error } = await supabaseAdmin
    .from('companion_occupations')
    .select(`
      *,
      character:characters(id, name),
      occupation:occupations(title, prestige)
    `)
    .limit(200);

  if (error || !occupations) {
    logger.warn('companion-jobs:tick:fetch-failed', { error });
    return { processed: 0, events: 0 };
  }

  let events = 0;

  await Promise.allSettled(
    occupations.map(async (occ) => {
      if (!occ.character) return;
      if (Math.random() > 0.05) return; // 5% chance of career event per tick

      const charName = occ.character.name;
      const charId   = occ.character.id;
      const event    = pickCareerEvent(occ.occupation?.prestige ?? 50);

      await logOfflineEntry(charId, 'activity', event.narrative(charName, occ.occupation?.title ?? occ.employer));

      // Update salary if applicable
      if (event.salarDelta !== 0) {
        await supabaseAdmin
          .from('companion_occupations')
          .update({ salary: Math.max(0, occ.salary + event.salarDelta) })
          .eq('id', occ.id);
      }

      events++;
    }),
  );

  return { processed: occupations.length, events };
}

// ── Public: Read ───────────────────────────────────────────────────────────────

export async function getCompanionOccupation(
  characterId: string,
): Promise<CompanionOccupation | null> {
  const { data, error } = await supabaseAdmin
    .from('companion_occupations')
    .select('*, occupation:occupations(title, prestige, category, description)')
    .eq('character_id', characterId)
    .maybeSingle();

  if (error || !data) return null;
  return data as CompanionOccupation;
}

// ── Public: Prompt Formatter ───────────────────────────────────────────────────

export async function formatJobForPrompt(characterId: string): Promise<string> {
  const occ = await getCompanionOccupation(characterId);

  if (!occ) return '';

  const title    = occ.occupation?.title ?? occ.employer;
  const prestige = occ.occupation?.prestige;
  const desc     = occ.occupation?.description;

  const lines = [`Current role: ${title}`];

  if (desc) lines.push(desc);

  if (prestige !== undefined) {
    if (prestige >= 80) lines.push('This is a high-prestige position.');
    else if (prestige <= 25) lines.push('This is a modest, practical role.');
  }

  if (occ.salary > 0) {
    lines.push(salaryContext(occ.salary));
  }

  return `[Occupation]\n${lines.join('\n')}`;
}

// ── Internal ───────────────────────────────────────────────────────────────────

interface CareerEvent {
  narrative:  (name: string, role: string) => string;
  salarDelta: number;
}

function pickCareerEvent(prestige: number): CareerEvent {
  const events: CareerEvent[] = [
    {
      narrative: (n, r) => `${n} was asked to take on additional responsibilities in her ${r} role. She said yes.`,
      salarDelta: 500,
    },
    {
      narrative: (n, _r) => `${n} received recognition for her work. It came from somewhere she didn't expect.`,
      salarDelta: 0,
    },
    {
      narrative: (n, _r) => `A new client specifically requested ${n} by name. She considers this a good sign.`,
      salarDelta: 200,
    },
    {
      narrative: (n, _r) => `${n} turned down a different opportunity today. She didn't tell anyone why.`,
      salarDelta: 0,
    },
    {
      narrative: (n, _r) => `${n} has been putting in longer hours. Something is coming to a head at work.`,
      salarDelta: 0,
    },
    {
      narrative: (n, _r) => `${n} completed a project that had been running for months. She feels the difference.`,
      salarDelta: prestige > 60 ? 1000 : 300,
    },
  ];

  return events[Math.floor(Math.random() * events.length)]!;
}

function salaryContext(salary: number): string {
  if (salary > 10_000) return 'Very well compensated for this work.';
  if (salary > 5_000)  return 'Paid well enough that money is not a current concern.';
  if (salary > 2_000)  return 'Comfortable but not extravagant.';
  if (salary > 500)    return 'Getting by. Not comfortable.';
  return 'Financially stretched.';
}

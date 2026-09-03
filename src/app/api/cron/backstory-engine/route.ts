/**
 * GET /api/cron/backstory-engine — Automatic Backstory Expansion
 *
 * Runs daily (add to vercel.json cron alongside content-engine). For a
 * small rotating batch of active, brain-initialized characters that are
 * due (see backstory-engine.ts's isDueForExpansion), generates one new
 * character_knowledge entry each — auto-written straight into canon, no
 * admin review queue, matching the precedent digital-person-bootstrap.ts
 * already set for this table. Every candidate still passes
 * moderateCharacter() before being stored — see backstory-engine.ts.
 *
 * Deliberately small batch + long per-character cadence (14+ days between
 * expansions, see MIN_DAYS_BETWEEN_EXPANSIONS) — this should read as a
 * character's world slowly deepening, not a nightly content mill.
 *
 * Security: Vercel Cron injects Authorization: Bearer {CRON_SECRET}.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth }           from '@/lib/security';
import { supabaseAdmin }             from '@/lib/supabase/admin';
import { logger }                    from '@/lib/logger';
import { env }                       from '@/env';
import { heartbeatStart, heartbeatSuccess, heartbeatFail } from '@/lib/cron/heartbeat';
import { expandBackstory, isDueForExpansion, type BackstoryExpansionInput } from '@/lib/ai/backstory-engine';

export const runtime      = 'nodejs';
export const dynamic      = 'force-dynamic';
export const maxDuration  = 280;

// Small batch per run — hits OpenRouter + the moderation gate per
// character, same cost-conscious stance as content-engine's cron.
const CHARACTERS_PER_RUN = 15;

const CHARACTER_FIELDS =
  'id,name,description,personality,backstory,archetype,origin,occupation,' +
  'values_list,fears,is_nsfw,active,brain_initialized,' +
  'backstory_expanded_at,backstory_expansion_count';

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const heartbeatName = 'BACKSTORY_ENGINE' as const;
  await heartbeatStart(heartbeatName);

  try {
    // Oldest-expanded-first (nulls first — never-expanded characters go
    // first), scoped to characters whose brain is actually initialized
    // (unbootstrapped characters have no baseline canon to stay consistent
    // with — see digital-person-bootstrap.ts).
    const { data: characters } = await supabaseAdmin
      .from('characters')
      .select(CHARACTER_FIELDS)
      .eq('active', true)
      .eq('brain_initialized', true)
      .order('backstory_expanded_at', { ascending: true, nullsFirst: true })
      .limit(CHARACTERS_PER_RUN * 3); // overfetch — many will be filtered out by isDueForExpansion's cadence check

    const candidates = ((characters ?? []) as unknown as BackstoryExpansionInput[])
      .filter(isDueForExpansion)
      .slice(0, CHARACTERS_PER_RUN);

    let expanded = 0;
    let skippedOrFailed = 0;

    for (const character of candidates) {
      const entry = await expandBackstory(character);
      if (entry) expanded++;
      else skippedOrFailed++;
    }

    logger.info('cron:backstory-engine complete', {
      charactersConsidered: candidates.length,
      expanded,
      skippedOrFailed,
    });

    await heartbeatSuccess(heartbeatName);

    return NextResponse.json({
      ok: true,
      charactersConsidered: candidates.length,
      expanded,
      skippedOrFailed,
    });
  } catch (err) {
    logger.error('cron:backstory-engine failed', { error: String(err) });
    await heartbeatFail(heartbeatName);
    return NextResponse.json({ error: 'backstory-engine cron failed' }, { status: 500 });
  }
}

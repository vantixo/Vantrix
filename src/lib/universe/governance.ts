/**
 * Governance Engine — City Political Systems
 *
 * "Political decisions have consequences. Approval ratings shift.
 * Laws are passed and repealed. Cities don't stand still."
 *
 * Each city/location has a governance record: approval_rating, stability,
 * corruption, government_type, and an optional leader character.
 * The governance tick applies small stochastic drift so cities feel
 * politically alive between user sessions.
 *
 * Events generated here (protests, reforms, corruption exposés) are logged
 * as political_events and surface in world history and character prompts.
 */

import { supabaseAdmin }  from '@/lib/supabase/admin';
import { logger }         from '@/lib/logger';
import { narrate }        from './narrator';
import { resolveLocationChoiceLean } from './daily-choice';

// ── Public: Tick ───────────────────────────────────────────────────────────────

/**
 * Run the governance tick for a specific city location.
 * Called by the world worker for each 'governance_tick' job.
 *
 * Guarded against being applied twice within the same ~4h tick window —
 * governance_tick has two independent entry points that can both enqueue a
 * job for the same location (the scheduled cron in api/cron/governance-
 * tick/route.ts, and full_universe_tick, dispatched separately in
 * api/workers/run/route.ts), so a cron-level lock alone isn't sufficient
 * here. The UPDATE below only matches a row whose last_ticked_at is NULL
 * or older than the guard window, so even if both paths enqueue a job for
 * the same city close together, only the first applied write actually
 * sticks — the second's WHERE clause fails to match and is treated as a
 * no-op.
 *
 * last_ticked_at (20260711_tick_last_ticked_at.sql) is dedicated to this
 * guard, deliberately separate from `updated_at` — any unrelated write to
 * this row would also refresh updated_at, which would falsely block the
 * next legitimate tick if it were reused as the guard.
 */
export async function runGovernanceTick(
  locationId: string,
): Promise<{ location_id: string; approval_delta: number; stability_delta: number }> {
  const { data: gov, error } = await supabaseAdmin
    .from('city_governance')
    .select('*, location:world_locations(name)')
    .eq('location_id', locationId)
    .maybeSingle();

  if (error || !gov) {
    // Bootstrap governance row if missing
    await bootstrapGovernance(locationId);
    return { location_id: locationId, approval_delta: 0, stability_delta: 0 };
  }

  const cityName      = (gov.location as { name: string } | null)?.name ?? 'the city';
  let approvalDelta = stochasticDrift(gov.approval_rating);
  let stabilityDelta = stochasticDrift(gov.stability);
  let corruptionDrift = Math.random() < 0.1 ? (Math.random() > 0.5 ? 2 : -2) : 0;

  // Apply the outcome of a user-voted daily world choice, if one is
  // waiting to resolve for this city. This is a single one-time nudge
  // (see resolveLocationChoiceLean's doc comment for the consume-once
  // guarantee) added on top of ordinary drift, not a replacement for it —
  // the city keeps evolving even in seasons with no active choice.
  const lean = await resolveLocationChoiceLean(locationId, 'governance_pressure');
  const GOVERNANCE_LEAN_MAGNITUDE = 5; // meaningful next to ±6 stochastic drift, not dominant
  if (lean) {
    const nudge = lean.direction * GOVERNANCE_LEAN_MAGNITUDE;
    if (lean.field === 'approval_rating') approvalDelta += nudge;
    else if (lean.field === 'stability')   stabilityDelta += nudge;
    else if (lean.field === 'corruption')  corruptionDrift += nudge;
  }

  const newApproval   = clamp(gov.approval_rating  + approvalDelta,  0, 100);
  const newStability  = clamp(gov.stability         + stabilityDelta, 0, 100);
  const newCorruption = clamp((gov.corruption ?? 20) + corruptionDrift, 0, 100);

  const guardCutoff = new Date(Date.now() - 3 * 60 * 60 * 1000 - 50 * 60 * 1000).toISOString(); // 3h50m guard band, 4h cadence

  const { data: applied } = await supabaseAdmin
    .from('city_governance')
    .update({
      approval_rating: newApproval,
      stability:       newStability,
      corruption:      newCorruption,
      last_ticked_at:  new Date().toISOString(),
    })
    .eq('location_id', locationId)
    .or(`last_ticked_at.is.null,last_ticked_at.lt.${guardCutoff}`)
    .select('location_id')
    .maybeSingle();

  if (!applied) {
    // Another invocation already ticked this city within the current
    // window — no-op, not an error. See guard comment above. Note: if a
    // vote lean was resolved above, it's already consumed at this point
    // and won't be re-offered to the next tick — same trade-off the
    // pre-existing last_ticked_at guard already accepts for ordinary
    // drift on a duplicate-invocation race, which is rare enough (see
    // acquireCronLock at the call site) not to warrant more complexity here.
    logger.info('governance:tick-skipped-already-applied', { locationId });
    return { location_id: locationId, approval_delta: 0, stability_delta: 0 };
  }

  // Log a narrative event when things shift noticeably
  if (Math.abs(approvalDelta) >= 4 || Math.abs(stabilityDelta) >= 4) {
    const narrative = approvalDelta < -4
      ? narrate.approvalChange(approvalDelta, cityName)
      : approvalDelta > 4
      ? narrate.approvalChange(approvalDelta, cityName)
      : narrate.stabilityChange(stabilityDelta, cityName);

    if (Math.random() < 0.3 && newCorruption > 60) {
      const corruptionNarrative = narrate.corruptionExposed(cityName);
      await logPoliticalEvent(locationId, 'corruption_exposed', corruptionNarrative, 3);
    } else {
      await logPoliticalEvent(
        locationId,
        approvalDelta < 0 ? 'approval_decline' : 'approval_increase',
        narrative,
        Math.abs(approvalDelta) > 8 ? 4 : 2,
      );
    }
  }

  return { location_id: locationId, approval_delta: approvalDelta, stability_delta: stabilityDelta };
}

// ── Public: Prompt Formatter ───────────────────────────────────────────────────

export async function formatGovernanceForPrompt(characterId: string): Promise<string> {
  // Get character's home location via occupation
  const { data: occupation } = await supabaseAdmin
    .from('companion_occupations')
    .select('location_id')
    .eq('character_id', characterId)
    .maybeSingle();

  if (!occupation?.location_id) return '';

  const { data: gov } = await supabaseAdmin
    .from('city_governance')
    .select('approval_rating, stability, government_type, location:world_locations(name)')
    .eq('location_id', occupation.location_id)
    .maybeSingle();

  if (!gov) return '';

  const cityName = (gov.location as { name: string } | null)?.name ?? 'the city';
  const lines = [
    `${cityName} governance: ${gov.government_type ?? 'council'}`,
    `Public approval: ${ratingLabel(gov.approval_rating)} (${gov.approval_rating}/100)`,
  ];

  if (gov.stability < 40) {
    lines.push('Political stability is low. People feel it.');
  } else if (gov.stability > 75) {
    lines.push('The government is stable. Routine is holding.');
  }

  return `[Local Politics]\n${lines.join('\n')}`;
}

// ── Internal ───────────────────────────────────────────────────────────────────

async function bootstrapGovernance(locationId: string): Promise<void> {
  await supabaseAdmin
    .from('city_governance')
    .upsert(
      {
        location_id:     locationId,
        approval_rating: 55 + Math.floor(Math.random() * 20),
        stability:       50 + Math.floor(Math.random() * 30),
        corruption:      10 + Math.floor(Math.random() * 30),
        government_type: 'council',
        laws:            [],
      },
      { onConflict: 'location_id', ignoreDuplicates: true },
    );
}

async function logPoliticalEvent(
  locationId: string,
  eventType:  string,
  description: string,
  severity:   number,
): Promise<void> {
  await supabaseAdmin.from('political_events').insert({
    event_type:  eventType,
    title:       narrativeTitle(eventType),
    description,
    location_id: locationId,
    severity,
  }).then(({ error }) => {
    if (error) logger.warn('governance:log-event:failed', { locationId, error });
  });
}

function narrativeTitle(eventType: string): string {
  const TITLES: Record<string, string> = {
    approval_decline: 'Public Confidence Erodes',
    approval_increase: 'Government Earns Goodwill',
    corruption_exposed: 'Accountability Questions Emerge',
  };
  return TITLES[eventType] ?? 'Political Development';
}

function stochasticDrift(current: number): number {
  // Mean-reverting drift toward 50, ±6
  const pull    = (50 - current) * 0.05;
  const random  = (Math.random() - 0.5) * 12;
  return Math.round(pull + random);
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function ratingLabel(rating: number): string {
  if (rating >= 75) return 'high';
  if (rating >= 50) return 'moderate';
  if (rating >= 30) return 'low';
  return 'very low';
}

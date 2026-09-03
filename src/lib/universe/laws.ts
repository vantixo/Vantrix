/**
 * Laws Engine — Proposal & Voting
 *
 * A city's governance can have proposed laws in flight. Each law_vote tick:
 *  - drifts support on active proposals toward pass/fail based on the city's
 *    approval_rating and stability (stable, popular governments pass more)
 *  - resolves proposals that cross a threshold (support >= 65 passes,
 *    support <= 25 fails) or have been open too long
 *  - occasionally proposes a new law when a city has no open proposals
 *
 * Passed laws are appended to city_governance.laws (the string[] already
 * read by formatGovernanceForPrompt / getCharacterLocationContext) so
 * outcomes are immediately visible in character prompts without any
 * additional read-path changes.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';
import { narrate }       from './narrator';

const RESOLVE_AFTER_MS = 3 * 24 * 60 * 60 * 1000; // 3 days of in-world ticking

const LAW_TEMPLATES: { category: string; title: string; description: string }[] = [
  { category: 'economic', title: 'Market Stall Licensing Reform', description: 'Simplifies licensing for small vendors and street markets.' },
  { category: 'social',   title: 'Public Festival Funding Act',    description: 'Allocates city funds toward seasonal festivals and public gatherings.' },
  { category: 'security', title: 'Neighborhood Watch Expansion',   description: 'Expands citizen patrol programs in outer districts.' },
  { category: 'civic',    title: 'Open Council Records Act',       description: 'Requires council meeting minutes to be published publicly.' },
  { category: 'economic', title: 'Guild Tariff Adjustment',        description: 'Adjusts import tariffs affecting local guild trade.' },
  { category: 'social',   title: 'Housing Assistance Ordinance',   description: 'Establishes a fund to assist displaced or struggling residents.' },
];

export async function runLawVote(
  locationId: string,
): Promise<{ location_id: string; resolved: number; proposed: number }> {
  const { data: gov } = await supabaseAdmin
    .from('city_governance')
    .select('approval_rating, stability, laws')
    .eq('location_id', locationId)
    .maybeSingle();

  if (!gov) return { location_id: locationId, resolved: 0, proposed: 0 };

  const { data: openLaws } = await supabaseAdmin
    .from('proposed_laws')
    .select('*')
    .eq('location_id', locationId)
    .eq('status', 'proposed');

  let resolved = 0;
  let proposed = 0;

  for (const law of openLaws ?? []) {
    // Claim this law's tick atomically before touching support. A single
    // runLawVote() call drifts every open proposal for the location in one
    // pass, so — unlike elections.ts, which guards one active election row
    // per city — the guard here is per-law-row: two concurrent/retried
    // invocations of runLawVote(locationId) would otherwise both read the
    // same `support` value and both apply their own drift on top, silently
    // double-counting it. The conditional UPDATE only succeeds for whichever
    // caller gets there first; the loser skips this law rather than
    // redrifting it. Mirrors the claim pattern in elections.ts's
    // advanceCampaign/resolveElection.
    const guardCutoff = new Date(Date.now() - 55 * 60 * 1000).toISOString(); // 55min guard, ticks run well under 1h apart
    const { data: claimed } = await supabaseAdmin
      .from('proposed_laws')
      .update({ last_ticked_at: new Date().toISOString() })
      .eq('id', law.id)
      .eq('status', 'proposed')
      .or(`last_ticked_at.is.null,last_ticked_at.lt.${guardCutoff}`)
      .select('id')
      .maybeSingle();

    if (!claimed) continue;

    const { data: voteRows } = await supabaseAdmin
      .from('law_user_votes')
      .select('position')
      .eq('law_id', law.id);

    let supportVotes = 0;
    let opposeVotes = 0;
    for (const v of voteRows ?? []) {
      if (v.position === 'support') supportVotes++;
      else opposeVotes++;
    }
    // Net user backing nudges support, capped so a handful of votes can't
    // singlehandedly pass/fail a law, but real groundswell shows — same
    // cap shape as elections.ts's userNudge on candidate polling.
    const userNudge = clamp((supportVotes - opposeVotes) * 0.6, -12, 12);

    const favorability = (gov.approval_rating - 50) * 0.15 + (gov.stability - 50) * 0.1;
    const drift = favorability + userNudge + (Math.random() - 0.5) * 14;
    const newSupport = clamp(law.support + drift, 0, 100);

    const ageMs = Date.now() - new Date(law.proposed_at).getTime();
    const shouldResolve = newSupport >= 65 || newSupport <= 25 || ageMs >= RESOLVE_AFTER_MS;

    if (!shouldResolve) {
      await supabaseAdmin.from('proposed_laws').update({ support: newSupport }).eq('id', law.id);
      continue;
    }

    const passed = newSupport >= 50;
    await supabaseAdmin
      .from('proposed_laws')
      .update({ support: newSupport, status: passed ? 'passed' : 'rejected', resolved_at: new Date().toISOString() })
      .eq('id', law.id);
    resolved++;

    if (passed) {
      const updatedLaws = Array.from(new Set([...(gov.laws ?? []), law.title]));
      await supabaseAdmin.from('city_governance').update({ laws: updatedLaws }).eq('location_id', locationId);
    }

    await logPoliticalEvent(
      locationId,
      passed ? 'law_passed' : 'law_rejected',
      passed ? narrate.lawPassed(law.title) : narrate.lawRejected(law.title),
      passed ? 3 : 2,
    );
  }

  // Propose a new law if the city has none in flight (cap at 2 concurrent)
  const { count: openCount } = await supabaseAdmin
    .from('proposed_laws')
    .select('id', { count: 'exact', head: true })
    .eq('location_id', locationId)
    .eq('status', 'proposed');

  if ((openCount ?? 0) < 2 && Math.random() < 0.35) {
    const template = LAW_TEMPLATES[Math.floor(Math.random() * LAW_TEMPLATES.length)]!;
    const { data: rulingFaction } = await supabaseAdmin
      .from('factions')
      .select('id')
      .eq('location_id', locationId)
      .eq('is_ruling', true)
      .maybeSingle();

    await supabaseAdmin.from('proposed_laws').insert({
      location_id:            locationId,
      title:                  template.title,
      description:            template.description,
      category:               template.category,
      support:                45 + Math.floor(Math.random() * 20),
      proposed_by_faction_id: rulingFaction?.id ?? null,
    });
    proposed++;

    await logPoliticalEvent(locationId, 'law_proposed', narrate.lawProposed(template.title), 1);
  }

  return { location_id: locationId, resolved, proposed };
}

// ── User Participation ──────────────────────────────────────────────────────

export interface CastLawVoteResult {
  ok: boolean;
  reason?: string;
}

/**
 * Cast (or change) a user's support/oppose position on a law that's still
 * 'proposed'. Upserts on the (law_id, user_id) unique constraint so
 * re-voting just moves their position rather than erroring.
 */
export async function castLawVote(
  lawId:    string,
  position: 'support' | 'oppose',
  userId:   string,
): Promise<CastLawVoteResult> {
  const { data: law } = await supabaseAdmin
    .from('proposed_laws')
    .select('status')
    .eq('id', lawId)
    .maybeSingle();

  if (!law) return { ok: false, reason: 'law_not_found' };
  if (law.status !== 'proposed') return { ok: false, reason: 'voting_closed' };

  const { error } = await supabaseAdmin
    .from('law_user_votes')
    .upsert(
      { law_id: lawId, position, user_id: userId, cast_at: new Date().toISOString() },
      { onConflict: 'law_id,user_id' },
    );

  if (error) {
    logger.warn('laws:cast-vote:failed', { lawId, userId, error });
    return { ok: false, reason: 'write_failed' };
  }

  return { ok: true };
}

export async function retractLawVote(lawId: string, userId: string): Promise<CastLawVoteResult> {
  const { error } = await supabaseAdmin
    .from('law_user_votes')
    .delete()
    .eq('law_id', lawId)
    .eq('user_id', userId);

  if (error) return { ok: false, reason: 'write_failed' };
  return { ok: true };
}

export async function getUserLawVote(lawId: string, userId: string): Promise<'support' | 'oppose' | null> {
  const { data } = await supabaseAdmin
    .from('law_user_votes')
    .select('position')
    .eq('law_id', lawId)
    .eq('user_id', userId)
    .maybeSingle();

  return (data?.position as 'support' | 'oppose' | undefined) ?? null;
}

/**
 * Active (status = 'proposed') law proposals a user can currently see/vote
 * on, with the user's own position if they've voted.
 */
export async function getActiveLawsForUser(userId: string) {
  const { data: laws } = await supabaseAdmin
    .from('proposed_laws')
    .select('*, location:world_locations(id, name)')
    .eq('status', 'proposed')
    .order('proposed_at', { ascending: false });

  if (!laws || laws.length === 0) return [];

  const { data: myVotes } = await supabaseAdmin
    .from('law_user_votes')
    .select('law_id, position')
    .eq('user_id', userId)
    .in('law_id', laws.map((l) => l.id));

  const voteByLaw = new Map((myVotes ?? []).map((v) => [v.law_id, v.position]));

  return laws.map((l) => ({ ...l, my_vote: voteByLaw.get(l.id) ?? null }));
}

/**
 * Recently resolved laws a user voted on, for a "here's what happened"
 * summary — mirrors elections.ts's getRecentResultsForUser.
 */
export async function getRecentLawResultsForUser(userId: string, limit = 10) {
  const { data: myVotes } = await supabaseAdmin
    .from('law_user_votes')
    .select('law_id, position')
    .eq('user_id', userId)
    .limit(200);

  if (!myVotes || myVotes.length === 0) return [];

  const { data: laws } = await supabaseAdmin
    .from('proposed_laws')
    .select('*, location:world_locations(id, name)')
    .in('status', ['passed', 'rejected'])
    .in('id', myVotes.map((v) => v.law_id))
    .order('resolved_at', { ascending: false })
    .limit(limit);

  const positionByLaw = new Map(myVotes.map((v) => [v.law_id, v.position]));

  return (laws ?? []).map((l) => ({
    ...l,
    my_position: positionByLaw.get(l.id) ?? null,
  }));
}

async function logPoliticalEvent(locationId: string, eventType: string, description: string, severity: number): Promise<void> {
  await supabaseAdmin.from('political_events').insert({
    event_type: eventType,
    title: titleFor(eventType),
    description,
    location_id: locationId,
    severity,
  }).then(({ error }) => {
    if (error) logger.warn('laws:log-event:failed', { locationId, error });
  });
}

function titleFor(eventType: string): string {
  return {
    law_passed:   'New Law Enacted',
    law_rejected: 'Proposal Fails',
    law_proposed: 'New Legislation Proposed',
  }[eventType] ?? 'Legislative Development';
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

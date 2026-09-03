/**
 * Elections Engine
 *
 * Cities occasionally hold elections for their leader_character_id seat.
 * Lifecycle per election_process tick, driven off city_governance.stability:
 *
 *   no election, low stability (<35), no election in last 30d → call one
 *   campaigning  → candidate polling drifts, advances to 'voting' after ~2d
 *   voting       → resolves a winner, updates city_governance.leader_character_id
 *                  and government_type stays intact (elections change leaders,
 *                  not regime type — see runFactionEvolve for regime change)
 *
 * Candidates are drawn from characters already tied to the location via
 * companion_occupations, biased toward higher-influence factions.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';
import { narrate }       from './narrator';

const CAMPAIGN_MS = 2 * 24 * 60 * 60 * 1000; // 2 in-world days of campaigning
const MIN_GAP_MS  = 30 * 24 * 60 * 60 * 1000; // don't re-call within 30 days

export async function runElectionProcess(
  locationId: string,
): Promise<{ location_id: string; action: string }> {
  const { data: active } = await supabaseAdmin
    .from('elections')
    .select('*')
    .eq('location_id', locationId)
    .neq('status', 'concluded')
    .order('called_at', { ascending: false })
    .maybeSingle();

  if (active) {
    return active.status === 'campaigning'
      ? advanceCampaign(active)
      : resolveElection(active);
  }

  return maybeCallElection(locationId);
}

// ── Call ──────────────────────────────────────────────────────────────────────

async function maybeCallElection(locationId: string): Promise<{ location_id: string; action: string }> {
  const { data: gov } = await supabaseAdmin
    .from('city_governance')
    .select('stability, government_type')
    .eq('location_id', locationId)
    .maybeSingle();

  if (!gov || gov.government_type === 'autocracy') {
    return { location_id: locationId, action: 'skipped_ineligible' };
  }

  const { data: lastElection } = await supabaseAdmin
    .from('elections')
    .select('concluded_at')
    .eq('location_id', locationId)
    .order('concluded_at', { ascending: false })
    .maybeSingle();

  if (lastElection?.concluded_at) {
    const sinceLast = Date.now() - new Date(lastElection.concluded_at).getTime();
    if (sinceLast < MIN_GAP_MS) return { location_id: locationId, action: 'skipped_too_recent' };
  }

  // Low stability raises odds of a snap election; otherwise it's a rare
  // scheduled occurrence so cities don't churn leaders constantly.
  const chance = gov.stability < 35 ? 0.4 : 0.03;
  if (Math.random() >= chance) return { location_id: locationId, action: 'no_election_called' };

  const { data: candidates } = await supabaseAdmin
    .from('companion_occupations')
    .select('character_id, character:characters(id, name)')
    .eq('location_id', locationId)
    .limit(20);

  const pool = (candidates ?? []).filter((c) => c.character);
  if (pool.length < 2) return { location_id: locationId, action: 'skipped_no_candidates' };

  const chosen = shuffle(pool).slice(0, Math.min(4, pool.length));

  const { data: election, error } = await supabaseAdmin
    .from('elections')
    .insert({ location_id: locationId, status: 'campaigning' })
    .select('id')
    .single();

  if (error || !election) return { location_id: locationId, action: 'failed_to_call' };

  await supabaseAdmin.from('election_candidates').insert(
    chosen.map((c) => ({
      election_id: election.id,
      character_id: c.character_id,
      polling: 20 + Math.floor(Math.random() * 30),
    })),
  );

  await logPoliticalEvent(locationId, 'election_called', narrate.electionCalled(), 3);
  return { location_id: locationId, action: 'election_called' };
}

// ── Campaign ──────────────────────────────────────────────────────────────────

async function advanceCampaign(election: { id: string; called_at: string; location_id: string; last_ticked_at?: string | null }): Promise<{ location_id: string; action: string }> {
  // Claim this tick atomically before touching polling. Two concurrent
  // invocations for the same election (cron overlap, a retried queue job)
  // would otherwise both read the same candidate rows and both apply their
  // own npcDrift/userNudge on top — a lost-update race that silently
  // double-counts drift and vote-nudges. The conditional UPDATE only
  // succeeds for whichever caller gets there first; the loser no-ops,
  // matching the claim pattern already used by resolveLocationChoiceLean
  // and the tick guards in world-engine.ts/economy.ts.
  const guardCutoff = new Date(Date.now() - 55 * 60 * 1000).toISOString(); // 55min guard, ticks run well under 1h apart
  const { data: claimed } = await supabaseAdmin
    .from('elections')
    .update({ last_ticked_at: new Date().toISOString() })
    .eq('id', election.id)
    .eq('status', 'campaigning')
    .or(`last_ticked_at.is.null,last_ticked_at.lt.${guardCutoff}`)
    .select('id')
    .maybeSingle();

  if (!claimed) return { location_id: election.location_id, action: 'skipped_recently_ticked' };

  const { data: candidates } = await supabaseAdmin
    .from('election_candidates')
    .select('*')
    .eq('election_id', election.id);

  const { data: voteRows } = await supabaseAdmin
    .from('election_user_votes')
    .select('candidate_id')
    .eq('election_id', election.id);

  const voteCounts = new Map<string, number>();
  for (const v of voteRows ?? []) {
    voteCounts.set(v.candidate_id, (voteCounts.get(v.candidate_id) ?? 0) + 1);
  }

  for (const c of candidates ?? []) {
    const npcDrift = (Math.random() - 0.5) * 10;
    // User backing nudges polling too, capped so a handful of votes can't
    // singlehandedly swing an NPC-driven race, but a real groundswell shows.
    const userNudge = clamp((voteCounts.get(c.id) ?? 0) * 0.6, 0, 12);
    await supabaseAdmin
      .from('election_candidates')
      .update({ polling: clamp(c.polling + npcDrift + userNudge, 1, 95) })
      .eq('id', c.id);
  }

  const campaignAge = Date.now() - new Date(election.called_at).getTime();
  if (campaignAge >= CAMPAIGN_MS) {
    await supabaseAdmin.from('elections').update({ status: 'voting' }).eq('id', election.id);
    return { location_id: election.location_id, action: 'moved_to_voting' };
  }

  return { location_id: election.location_id, action: 'campaign_advanced' };
}

// ── Resolve ───────────────────────────────────────────────────────────────────

async function resolveElection(election: { id: string; location_id: string }): Promise<{ location_id: string; action: string }> {
  // Claim the "voting" → "concluded" transition atomically first. Without
  // this, a concurrent or retried call (queue job retry, overlapping cron
  // window) would independently pick a winner, overwrite city_governance's
  // leader a second time, and — worse — call notifyVoters again, sending
  // every voter a duplicate result feed entry. The conditional UPDATE only
  // matches while status is still 'voting', so only one caller wins the
  // claim; the loser sees the row already 'concluded' and no-ops rather
  // than redoing the resolution.
  const { data: claimed } = await supabaseAdmin
    .from('elections')
    .update({ status: 'concluded', concluded_at: new Date().toISOString() })
    .eq('id', election.id)
    .eq('status', 'voting')
    .select('id')
    .maybeSingle();

  if (!claimed) return { location_id: election.location_id, action: 'skipped_already_resolved' };

  const { data: candidates } = await supabaseAdmin
    .from('election_candidates')
    .select('*, character:characters(id, name)')
    .eq('election_id', election.id)
    .order('polling', { ascending: false });

  if (!candidates || candidates.length === 0) {
    return { location_id: election.location_id, action: 'concluded_no_candidates' };
  }

  const totalPolling = candidates.reduce((sum, c) => sum + c.polling, 0);
  const winner = candidates[0]!;
  const runnerUp = candidates[1];
  const turnout = 45 + Math.floor(Math.random() * 40);
  const margin = runnerUp ? Math.round(((winner.polling - runnerUp.polling) / totalPolling) * 100) : 100;

  await supabaseAdmin
    .from('elections')
    .update({
      winner_character_id: winner.character_id,
      turnout,
      margin,
    })
    .eq('id', election.id);

  await supabaseAdmin
    .from('city_governance')
    .update({ leader_character_id: winner.character_id })
    .eq('location_id', election.location_id);

  const winnerName = (winner.character as { name?: string } | null)?.name ?? 'A new leader';
  await logPoliticalEvent(election.location_id, 'election_concluded', narrate.electionWon(winnerName), 4);
  await notifyVoters(election.id, winner.id, winner.character_id, winnerName);

  return { location_id: election.location_id, action: 'concluded' };
}

// ── User Participation ──────────────────────────────────────────────────────

export interface CastVoteResult {
  ok: boolean;
  reason?: string;
}

/**
 * Cast (or change) a user's vote for a candidate in an election that's
 * still campaigning. Upserts on the (election_id, user_id) unique
 * constraint so re-voting just moves their pick rather than erroring.
 */
export async function castUserVote(
  electionId:  string,
  candidateId: string,
  userId:      string,
): Promise<CastVoteResult> {
  const { data: election } = await supabaseAdmin
    .from('elections')
    .select('status')
    .eq('id', electionId)
    .maybeSingle();

  if (!election) return { ok: false, reason: 'election_not_found' };
  if (election.status !== 'campaigning') return { ok: false, reason: 'voting_closed' };

  const { data: candidate } = await supabaseAdmin
    .from('election_candidates')
    .select('id')
    .eq('id', candidateId)
    .eq('election_id', electionId)
    .maybeSingle();

  if (!candidate) return { ok: false, reason: 'candidate_not_found' };

  const { error } = await supabaseAdmin
    .from('election_user_votes')
    .upsert(
      { election_id: electionId, candidate_id: candidateId, user_id: userId, cast_at: new Date().toISOString() },
      { onConflict: 'election_id,user_id' },
    );

  if (error) {
    logger.warn('elections:cast-vote:failed', { electionId, userId, error });
    return { ok: false, reason: 'write_failed' };
  }

  return { ok: true };
}

export async function retractUserVote(electionId: string, userId: string): Promise<CastVoteResult> {
  const { error } = await supabaseAdmin
    .from('election_user_votes')
    .delete()
    .eq('election_id', electionId)
    .eq('user_id', userId);

  if (error) return { ok: false, reason: 'write_failed' };
  return { ok: true };
}

export async function getUserVote(electionId: string, userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('election_user_votes')
    .select('candidate_id')
    .eq('election_id', electionId)
    .eq('user_id', userId)
    .maybeSingle();

  return data?.candidate_id ?? null;
}

/**
 * Active (campaigning or voting) elections a user can currently see/vote
 * in, with candidates and the user's own pick if they've voted.
 */
export async function getActiveElectionsForUser(userId: string) {
  const { data: elections } = await supabaseAdmin
    .from('elections')
    .select('*, location:world_locations(id, name), candidates:election_candidates(*, character:characters(id, name, image_url))')
    .neq('status', 'concluded')
    .order('called_at', { ascending: false });

  if (!elections || elections.length === 0) return [];

  const { data: myVotes } = await supabaseAdmin
    .from('election_user_votes')
    .select('election_id, candidate_id')
    .eq('user_id', userId)
    .in('election_id', elections.map((e) => e.id));

  const voteByElection = new Map((myVotes ?? []).map((v) => [v.election_id, v.candidate_id]));

  return elections.map((e) => ({ ...e, my_vote: voteByElection.get(e.id) ?? null }));
}

/**
 * Recently concluded elections a user voted in, for a "here's what
 * happened" summary — used by the API route rather than the feed fan-out
 * (which already covers the push notification side via notifyVoters).
 */
export async function getRecentResultsForUser(userId: string, limit = 10) {
  const { data: myVotes } = await supabaseAdmin
    .from('election_user_votes')
    .select('election_id, candidate_id')
    .eq('user_id', userId)
    .limit(200);

  if (!myVotes || myVotes.length === 0) return [];

  const { data: elections } = await supabaseAdmin
    .from('elections')
    .select('*, location:world_locations(id, name), winner:characters!elections_winner_character_id_fkey(id, name, image_url)')
    .eq('status', 'concluded')
    .in('id', myVotes.map((v) => v.election_id))
    .order('concluded_at', { ascending: false })
    .limit(limit);

  const votedFor = new Map(myVotes.map((v) => [v.election_id, v.candidate_id]));

  return (elections ?? []).map((e) => ({
    ...e,
    my_candidate_id: votedFor.get(e.id) ?? null,
  }));
}

async function notifyVoters(
  electionId: string,
  winnerCandidateId: string,
  winnerCharacterId: string | null,
  winnerName: string,
): Promise<void> {
  // user_feeds.character_id is NOT NULL — a faction-only winner (no
  // character_id) has nothing to attribute the feed entry to. Log and skip
  // rather than let a null reach the insert and fail the whole batch.
  if (!winnerCharacterId) {
    logger.warn('elections:notify-voters:no-winner-character', { electionId, winnerCandidateId });
    return;
  }

  const { data: voters } = await supabaseAdmin
    .from('election_user_votes')
    .select('user_id, candidate_id')
    .eq('election_id', electionId);

  if (!voters || voters.length === 0) return;

  const entries = voters.map((v) => ({
    user_id:      v.user_id,
    character_id: winnerCharacterId,
    entry_type:   'election_result',
    is_read:      false,
    content:      v.candidate_id === winnerCandidateId
      ? `Your pick won! ${winnerName} has been elected — you backed the winner.`
      : `The results are in — ${winnerName} won the election. Your candidate didn't make it this time.`,
  }));

  const { error } = await supabaseAdmin.from('user_feeds').insert(entries);
  if (error) logger.warn('elections:notify-voters:failed', { electionId, error });
}

// ── Shared ────────────────────────────────────────────────────────────────────

async function logPoliticalEvent(locationId: string, eventType: string, description: string, severity: number): Promise<void> {
  await supabaseAdmin.from('political_events').insert({
    event_type: eventType,
    title: titleFor(eventType),
    description,
    location_id: locationId,
    severity,
  }).then(({ error }) => {
    if (error) logger.warn('elections:log-event:failed', { locationId, error });
  });
}

function titleFor(eventType: string): string {
  return {
    election_called:    'Election Called',
    election_concluded: 'Election Results',
  }[eventType] ?? 'Electoral Development';
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/**
 * Consensus Engine
 *
 * Voting and group decision-making inside an organization. A proposal opens,
 * members cast weighted votes (weight comes from `standing`, so respected
 * members carry more sway), and it resolves — by explicit tally or by the
 * world tick catching an expired proposal. Outcomes feed back into
 * `collective-memory.ts` so a group remembers what it decided, and into
 * `leadership-engine.ts` for leadership-related proposals (ousting, electing).
 */

import { supabaseAdmin }      from '@/lib/supabase/admin';
import { logger }             from '@/lib/logger';
import { getMembers }         from './organization-engine';
import { recordMemory }       from './collective-memory';

export type ProposalStatus = 'open' | 'passed' | 'rejected' | 'expired';
export type Vote = 'for' | 'against' | 'abstain';

export interface ConsensusProposal {
  id:               string;
  organization_id:  string;
  proposer_id:      string;
  title:            string;
  description:      string | null;
  status:           ProposalStatus;
  threshold:        number;
  opened_at:        string;
  resolves_at:      string;
  resolved_at:      string | null;
}

// ── Public: Propose ────────────────────────────────────────────────────────────

export async function openProposal(params: {
  organizationId: string;
  proposerId:     string;
  title:          string;
  description?:   string;
  threshold?:     number;
  windowHours?:   number;
}): Promise<ConsensusProposal | null> {
  const resolvesAt = new Date(Date.now() + (params.windowHours ?? 24) * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabaseAdmin
    .from('consensus_proposals')
    .insert({
      organization_id: params.organizationId,
      proposer_id:     params.proposerId,
      title:           params.title,
      description:     params.description ?? null,
      threshold:       params.threshold ?? 0.5,
      resolves_at:     resolvesAt,
    })
    .select('*')
    .maybeSingle();

  if (error) {
    logger.warn('consensus-engine:open-failed', { error, organizationId: params.organizationId });
    return null;
  }
  return data as ConsensusProposal;
}

// ── Public: Vote ───────────────────────────────────────────────────────────────

export async function castVote(proposalId: string, characterId: string, vote: Vote): Promise<void> {
  const { data: proposal } = await supabaseAdmin
    .from('consensus_proposals')
    .select('organization_id, status')
    .eq('id', proposalId)
    .maybeSingle();

  if (!proposal || proposal.status !== 'open') return;

  const members = await getMembers(proposal.organization_id);
  const member = members.find((m) => m.character_id === characterId);
  const weight = member ? standingToWeight(member.standing) : 0.5;

  const { error } = await supabaseAdmin
    .from('consensus_votes')
    .upsert(
      { proposal_id: proposalId, character_id: characterId, vote, weight },
      { onConflict: 'proposal_id,character_id' },
    );

  if (error) logger.warn('consensus-engine:vote-failed', { proposalId, characterId, error });
}

// ── Public: Resolve ────────────────────────────────────────────────────────────

/**
 * Tally an open proposal and resolve it if either the whole organization
 * has voted or its window has expired. Safe to call repeatedly — resolving
 * an already-resolved proposal is a no-op.
 */
export async function resolveProposal(proposalId: string): Promise<ConsensusProposal | null> {
  const { data: proposal } = await supabaseAdmin
    .from('consensus_proposals')
    .select('*')
    .eq('id', proposalId)
    .maybeSingle();

  if (!proposal || proposal.status !== 'open') return proposal as ConsensusProposal | null;

  const members = await getMembers(proposal.organization_id);
  const { data: votes } = await supabaseAdmin
    .from('consensus_votes')
    .select('vote, weight, character_id')
    .eq('proposal_id', proposalId);

  const expired = new Date(proposal.resolves_at).getTime() <= Date.now();
  const everyoneVoted = members.length > 0 && (votes?.length ?? 0) >= members.length;

  if (!expired && !everyoneVoted) return proposal as ConsensusProposal;

  const forWeight     = sumWeight(votes, 'for');
  const againstWeight = sumWeight(votes, 'against');
  const decisiveWeight = forWeight + againstWeight;

  let status: ProposalStatus;
  if (decisiveWeight === 0) {
    status = 'expired';
  } else {
    status = forWeight / decisiveWeight >= proposal.threshold ? 'passed' : 'rejected';
  }

  const { data: updated, error } = await supabaseAdmin
    .from('consensus_proposals')
    .update({ status, resolved_at: new Date().toISOString() })
    .eq('id', proposalId)
    .select('*')
    .maybeSingle();

  if (error) {
    logger.warn('consensus-engine:resolve-failed', { proposalId, error });
    return proposal as ConsensusProposal;
  }

  if (status !== 'expired') {
    await recordMemory({
      scopeType: 'organization',
      scopeId:   proposal.organization_id,
      summary:   `The group ${status} the proposal: "${proposal.title}".`,
      significance: 3,
      sourceCharacterId: proposal.proposer_id,
      tags: ['consensus', status],
    });
  }

  return updated as ConsensusProposal;
}

/** Sweep every open, expired proposal across all organizations. Call from the world tick. */
export async function resolveExpiredProposals(): Promise<number> {
  const { data: expired } = await supabaseAdmin
    .from('consensus_proposals')
    .select('id')
    .eq('status', 'open')
    .lte('resolves_at', new Date().toISOString());

  if (!expired || expired.length === 0) return 0;

  for (const p of expired) {
    await resolveProposal(p.id);
  }
  return expired.length;
}

// ── Public: Read ───────────────────────────────────────────────────────────────

export async function getOpenProposals(organizationId: string): Promise<ConsensusProposal[]> {
  const { data, error } = await supabaseAdmin
    .from('consensus_proposals')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('status', 'open')
    .order('opened_at', { ascending: false });

  if (error) return [];
  return (data ?? []) as ConsensusProposal[];
}

// ── Internal ──────────────────────────────────────────────────────────────────

function standingToWeight(standing: number): number {
  // 0-100 standing maps to a 0.5x-1.5x vote weight.
  return 0.5 + (standing / 100);
}

function sumWeight(votes: { vote: string; weight: number }[] | null, kind: Vote): number {
  return (votes ?? []).filter((v) => v.vote === kind).reduce((sum, v) => sum + v.weight, 0);
}

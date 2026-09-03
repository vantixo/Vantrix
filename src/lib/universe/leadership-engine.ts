/**
 * Leadership Engine
 *
 * Tracks who leads an organization over time. A leadership_terms row is
 * open-ended (ended_at null) while someone holds the role; approval drifts
 * each tick and a term that collapses far enough triggers an ouster and
 * succession, mirroring how `governance.ts` handles city approval but at
 * organization scale. Ousters and successions are proposal-driven when
 * `consensus-engine.ts` is available — this module also exposes a direct
 * path for when a proposal has already resolved in favor of a change.
 */

import { supabaseAdmin }   from '@/lib/supabase/admin';
import { logger }          from '@/lib/logger';
import { setRole, getMembers } from './organization-engine';
import { recordMemory }    from './collective-memory';
import { sendMessage }     from './agent-communication';

export type EndReason = 'ousted' | 'stepped_down' | 'succession';

export interface LeadershipTerm {
  id:               string;
  organization_id:  string;
  leader_id:        string;
  approval:         number;
  started_at:       string;
  ended_at:         string | null;
  end_reason:       EndReason | null;
}

const OUSTER_APPROVAL_FLOOR = 20;

// ── Public: Read ───────────────────────────────────────────────────────────────

export async function getCurrentLeader(organizationId: string): Promise<LeadershipTerm | null> {
  const { data, error } = await supabaseAdmin
    .from('leadership_terms')
    .select('*')
    .eq('organization_id', organizationId)
    .is('ended_at', null)
    .maybeSingle();

  if (error || !data) return null;
  return data as LeadershipTerm;
}

export async function getLeadershipHistory(organizationId: string, limit = 10): Promise<LeadershipTerm[]> {
  const { data, error } = await supabaseAdmin
    .from('leadership_terms')
    .select('*')
    .eq('organization_id', organizationId)
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) return [];
  return (data ?? []) as LeadershipTerm[];
}

// ── Public: Install / End ─────────────────────────────────────────────────────

/**
 * Install a new leader. Ends any current term first (defaulting to
 * 'succession' if one exists and no explicit reason was given for its end).
 */
export async function installLeader(
  organizationId: string,
  newLeaderId:    string,
  reason: EndReason = 'succession',
): Promise<LeadershipTerm | null> {
  const current = await getCurrentLeader(organizationId);
  if (current) {
    await endTerm(current.id, reason);
    await setRole(organizationId, current.leader_id, 'officer');
  }

  const { data, error } = await supabaseAdmin
    .from('leadership_terms')
    .insert({ organization_id: organizationId, leader_id: newLeaderId, approval: 60 })
    .select('*')
    .maybeSingle();

  if (error || !data) {
    logger.warn('leadership-engine:install-failed', { organizationId, newLeaderId, error });
    return null;
  }

  await setRole(organizationId, newLeaderId, 'leader');
  await recordMemory({
    scopeType: 'organization',
    scopeId:   organizationId,
    summary:   current
      ? `Leadership passed from one leader to another (${reason}).`
      : 'A new leader took charge for the first time.',
    significance: 4,
    sourceCharacterId: newLeaderId,
    tags: ['leadership', reason],
  });

  return data as LeadershipTerm;
}

export async function endTerm(termId: string, reason: EndReason): Promise<void> {
  await supabaseAdmin
    .from('leadership_terms')
    .update({ ended_at: new Date().toISOString(), end_reason: reason })
    .eq('id', termId)
    .then(({ error }) => {
      if (error) logger.warn('leadership-engine:end-term-failed', { termId, error });
    });
}

// ── Public: Tick ───────────────────────────────────────────────────────────────

/**
 * Drift approval for every active leadership term. A leader whose approval
 * collapses below the ouster floor is removed and succeeded automatically
 * by the highest-standing remaining officer/member — an emergent
 * succession rather than a scripted one.
 */
export async function runLeadershipTick(): Promise<{ processed: number; ousted: number }> {
  const { data: terms } = await supabaseAdmin
    .from('leadership_terms')
    .select('id, organization_id, leader_id, approval')
    .is('ended_at', null);

  if (!terms || terms.length === 0) return { processed: 0, ousted: 0 };

  let ousted = 0;

  for (const term of terms) {
    const drift = (Math.random() - 0.5) * 10;
    const newApproval = clamp(term.approval + drift, 0, 100);

    await supabaseAdmin.from('leadership_terms').update({ approval: newApproval }).eq('id', term.id);

    if (newApproval < OUSTER_APPROVAL_FLOOR) {
      await handleOuster(term.organization_id, term.id, term.leader_id);
      ousted++;
    }
  }

  return { processed: terms.length, ousted };
}

/** Directly oust the current leader and install a successor — used when a consensus proposal already resolved to do so. */
export async function ousterFromProposal(organizationId: string): Promise<LeadershipTerm | null> {
  const current = await getCurrentLeader(organizationId);
  if (!current) return null;
  return handleOuster(organizationId, current.id, current.leader_id);
}

// ── Public: Prompt Formatter ───────────────────────────────────────────────────

export async function formatLeadershipForPrompt(organizationId: string): Promise<string> {
  const leader = await getCurrentLeader(organizationId);
  if (!leader) return '';

  return `[Leadership]\nCurrent leader has ${approvalLabel(leader.approval)} approval within the group.`;
}

// ── Internal ──────────────────────────────────────────────────────────────────

async function handleOuster(
  organizationId: string,
  termId:         string,
  ousLeaderId:    string,
): Promise<LeadershipTerm | null> {
  await endTerm(termId, 'ousted');
  await setRole(organizationId, ousLeaderId, 'member');

  const members = await getMembers(organizationId);
  const successor = members
    .filter((m) => m.character_id !== ousLeaderId)
    .sort((a, b) => b.standing - a.standing)[0];

  await recordMemory({
    scopeType: 'organization',
    scopeId:   organizationId,
    summary:   'The leader was ousted after losing the group\'s confidence.',
    significance: 5,
    sourceCharacterId: ousLeaderId,
    tags: ['leadership', 'ousted'],
  });

  if (!successor) return null;

  const term = await installLeader(organizationId, successor.character_id, 'succession');
  if (term) {
    const peers = members.filter((m) => m.character_id !== successor.character_id);
    for (const peer of peers) {
      await sendMessage({
        senderId:    successor.character_id,
        recipientId: peer.character_id,
        messageType: 'directive',
        content:     'A new leader has taken charge following the ouster of the last.',
        topic:       'leadership_change',
      });
    }
  }
  return term;
}

function approvalLabel(approval: number): string {
  if (approval >= 70) return 'strong';
  if (approval >= 40) return 'shaky';
  return 'crumbling';
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

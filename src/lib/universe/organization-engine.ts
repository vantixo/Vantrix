/**
 * Organization Engine
 *
 * Sub-structures within (or independent of) a faction — guilds, councils,
 * companies, orders, circles. `consensus-engine.ts` runs votes inside an
 * organization; `leadership-engine.ts` tracks who leads one. This module
 * owns formation, membership, and the slow cohesion drift that determines
 * whether an organization holds together or falls apart.
 */

import { supabaseAdmin }   from '@/lib/supabase/admin';
import { logger }          from '@/lib/logger';
import { recordMemory, formatCollectiveMemoryForPrompt } from './collective-memory';

export type OrgType = 'guild' | 'council' | 'company' | 'order' | 'circle';
export type OrgRole = 'leader' | 'officer' | 'member' | 'initiate';

export interface Organization {
  id:            string;
  faction_id:    string | null;
  location_id:   string | null;
  name:          string;
  org_type:      OrgType;
  purpose:       string | null;
  cohesion:      number;
  active:        boolean;
  created_at:    string;
  dissolved_at:  string | null;
}

const DISSOLUTION_COHESION_FLOOR = 15;

// ── Public: Formation ─────────────────────────────────────────────────────────

export async function foundOrganization(params: {
  name:          string;
  orgType:       OrgType;
  founderId:     string;
  factionId?:    string;
  locationId?:   string;
  purpose?:      string;
}): Promise<Organization | null> {
  const { data: org, error } = await supabaseAdmin
    .from('organizations')
    .insert({
      name:        params.name,
      org_type:    params.orgType,
      faction_id:  params.factionId ?? null,
      location_id: params.locationId ?? null,
      purpose:     params.purpose ?? null,
      cohesion:    65,
    })
    .select('*')
    .maybeSingle();

  if (error || !org) {
    logger.warn('organization-engine:found-failed', { error, name: params.name });
    return null;
  }

  await addMember(org.id, params.founderId, 'leader');
  await recordMemory({
    scopeType: 'organization',
    scopeId:   org.id,
    summary:   `${params.name} was founded.`,
    significance: 4,
    sourceCharacterId: params.founderId,
    tags: ['founding'],
  });

  return org as Organization;
}

export async function dissolveOrganization(organizationId: string, reason: string): Promise<void> {
  await supabaseAdmin
    .from('organizations')
    .update({ active: false, dissolved_at: new Date().toISOString() })
    .eq('id', organizationId)
    .then(({ error }) => {
      if (error) logger.warn('organization-engine:dissolve-failed', { organizationId, error });
    });

  await recordMemory({
    scopeType: 'organization',
    scopeId:   organizationId,
    summary:   `The organization dissolved: ${reason}.`,
    significance: 4,
    tags: ['dissolution'],
  });
}

// ── Public: Membership ────────────────────────────────────────────────────────

export async function addMember(
  organizationId: string,
  characterId:    string,
  role: OrgRole = 'initiate',
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('organization_members')
    .upsert(
      { organization_id: organizationId, character_id: characterId, role, standing: 50 },
      { onConflict: 'organization_id,character_id' },
    );

  if (error) logger.warn('organization-engine:add-member-failed', { organizationId, characterId, error });
}

export async function removeMember(organizationId: string, characterId: string): Promise<void> {
  await supabaseAdmin
    .from('organization_members')
    .delete()
    .eq('organization_id', organizationId)
    .eq('character_id', characterId)
    .then(({ error }) => {
      if (error) logger.warn('organization-engine:remove-member-failed', { organizationId, characterId, error });
    });
}

export async function setRole(organizationId: string, characterId: string, role: OrgRole): Promise<void> {
  await supabaseAdmin
    .from('organization_members')
    .update({ role })
    .eq('organization_id', organizationId)
    .eq('character_id', characterId)
    .then(({ error }) => {
      if (error) logger.warn('organization-engine:set-role-failed', { organizationId, characterId, error });
    });
}

export async function getMembers(organizationId: string): Promise<
  { character_id: string; role: OrgRole; standing: number }[]
> {
  const { data, error } = await supabaseAdmin
    .from('organization_members')
    .select('character_id, role, standing')
    .eq('organization_id', organizationId)
    .order('standing', { ascending: false });

  if (error) return [];
  return (data ?? []).map((row) => ({ ...row, role: row.role as OrgRole }));
}

// ── Public: Tick ───────────────────────────────────────────────────────────────

/**
 * Drift each active organization's cohesion. Cohesion is a slow-moving
 * proxy for "does this group still hold together" — it nudges toward the
 * average standing of its members, with noise. An organization that falls
 * below the dissolution floor and doesn't recover is dissolved.
 */
export async function runOrganizationTick(): Promise<{ processed: number; dissolved: number }> {
  const { data: orgs } = await supabaseAdmin
    .from('organizations')
    .select('id, cohesion, name')
    .eq('active', true);

  if (!orgs || orgs.length === 0) return { processed: 0, dissolved: 0 };

  let dissolved = 0;

  for (const org of orgs) {
    const members = await getMembers(org.id);
    if (members.length === 0) {
      await dissolveOrganization(org.id, 'no members remained');
      dissolved++;
      continue;
    }

    const avgStanding = members.reduce((sum, m) => sum + m.standing, 0) / members.length;
    const pull = (avgStanding - org.cohesion) * 0.1;
    const noise = (Math.random() - 0.5) * 6;
    const newCohesion = clamp(org.cohesion + pull + noise, 0, 100);

    await supabaseAdmin.from('organizations').update({ cohesion: newCohesion }).eq('id', org.id);

    if (newCohesion < DISSOLUTION_COHESION_FLOOR) {
      await dissolveOrganization(org.id, `${org.name} lost cohesion and fell apart`);
      dissolved++;
    }
  }

  return { processed: orgs.length, dissolved };
}

export async function getCharacterOrganizationIds(characterId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('organization_members')
    .select('organization_id, organization:organizations(active)')
    .eq('character_id', characterId);

  if (error || !data) return [];
  return data
    .filter((row) => (row.organization as unknown as { active: boolean } | null)?.active)
    .map((row) => row.organization_id as string);
}

// ── Public: Prompt Formatter ───────────────────────────────────────────────────

export async function formatOrganizationForPrompt(characterId: string): Promise<string> {
  const { data: memberships } = await supabaseAdmin
    .from('organization_members')
    .select('role, organization:organizations(id, name, org_type, cohesion, active)')
    .eq('character_id', characterId);

  if (!memberships || memberships.length === 0) return '';

  const active = memberships
    .map((m) => ({
      role: m.role as OrgRole,
      org: m.organization as unknown as { id: string; name: string; org_type: string; cohesion: number; active: boolean },
    }))
    .filter((m) => m.org?.active);

  if (active.length === 0) return '';

  const lines = await Promise.all(active.map(async (m) => {
    const memoryBlock = await formatCollectiveMemoryForPrompt('organization', m.org.id).catch(() => '');
    const memoryNote = memoryBlock ? ` The group remembers: ${memoryBlock.split('\n').slice(1, 2).join('')}` : '';
    return `- ${m.role} of ${m.org.name} (${m.org.org_type}), ${cohesionLabel(m.org.cohesion)}.${memoryNote}`;
  }));

  return `[Organizational Ties]\n${lines.join('\n')}`;
}

// ── Internal ──────────────────────────────────────────────────────────────────

function cohesionLabel(cohesion: number): string {
  if (cohesion >= 75) return 'tightly bonded';
  if (cohesion >= 45) return 'holding together';
  return 'fraying';
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/**
 * Community Engine — Neighborhoods, Organizations, Clubs
 *
 * "A job is where you work. A faction is what you believe. A neighborhood
 * is where you actually live — and a club is who you show up for on a
 * Tuesday because you want to, not because you have to."
 *
 * Three independent-but-related layers, each already backed by its own
 * migration (20260911_community_engine.sql):
 *
 *   - Neighborhoods   — a finer subdivision of a world_locations row.
 *                        Residents accumulate slowly; cohesion drifts with
 *                        city governance stability, same drift shape
 *                        economy.ts uses for gdp/unemployment.
 *   - Organizations   — formal, mission-driven bodies (civic, labor,
 *                        charitable, professional, advocacy, religious,
 *                        academic). Distinct from companies.ts: influence
 *                        and cause, not capital and market share.
 *   - Clubs           — casual, interest-driven groups matched against
 *                        characters.tags. Lightest weight of the three:
 *                        no influence score, just members and a vibe.
 *
 * Four ticks, run in order by runCommunityTick():
 *
 *   1. SETTLEMENT   — characters with no neighborhood residence yet are
 *                      assigned one, preferring a neighborhood under their
 *                      existing occupation/company location if they have one.
 *   2. FOUNDING      — small per-tick chance an eligible, well-connected
 *                      character founds a new organization or club.
 *   3. MEMBERSHIP    — active orgs/clubs occasionally gain members from the
 *                      local, unaffiliated population; clubs also lose
 *                      members occasionally (interest fades) — orgs don't,
 *                      membership there is treated as more durable.
 *   4. COHESION DRIFT — neighborhood cohesion drifts toward a level set by
 *                      local governance stability, same bias direction
 *                      economy.ts's unemploymentDrift uses.
 *
 * Called by the world worker on 'community_tick' jobs (see
 * src/app/api/workers/run/route.ts), same cadence tier as faction_evolve/
 * company_tick (4h, companion-life-adjacent rather than per-message).
 */

import { supabaseAdmin }   from '@/lib/supabase/admin';
import { logOfflineEntry } from './life-engine';

// ── Embed-select shapes ──────────────────────────────────────────────────
// Supabase's generated client types don't reliably infer the shape of
// nested/embedded selects (e.g. an aliased `neighborhood:neighborhoods(...)`)
// — a known ecosystem limitation, not a "type doesn't exist" gap the way
// some earlier casts in this codebase were. These narrow the five spots
// below to exactly the fields actually read, in place of a blanket `as
// any`, so a typo'd field name is still caught at compile time.
interface CharacterNameEmbed {
  name: string;
}
interface LocationAliasEmbed {
  location: { location_id: string | null }[];
}
interface NeighborhoodEmbed {
  neighborhood: { name: string; vibe: string; cohesion: number } | null;
}
interface OrganizationEmbed {
  organization: { name: string; mission: string } | null;
}
interface ClubEmbed {
  club: { name: string; interest_tag: string } | null;
}

// ── Config ──────────────────────────────────────────────────────────────────

const ORG_FOUNDING_CHANCE_PER_TICK  = 0.015; // rarer than company founding — a cause, not a business
const CLUB_FOUNDING_CHANCE_PER_TICK = 0.03;  // clubs are easier to start than orgs
const MIN_PRESTIGE_TO_FOUND_ORG     = 45;    // lower bar than companies (55) — civic energy needs less standing than capital
const ORG_JOIN_CHANCE_PER_TICK      = 0.08;
const CLUB_JOIN_CHANCE_PER_TICK     = 0.12;  // clubs recruit more readily than orgs
const CLUB_ATTRITION_CHANCE_PER_TICK = 0.04; // interest fading is normal for a club, unlike an org
const MAX_ORG_INFLUENCE_GAIN        = 3;
const COHESION_DRIFT_RATE           = 0.04;

const ORG_CATEGORIES = ['civic', 'labor', 'charitable', 'professional', 'advocacy', 'religious', 'academic'] as const;
type OrgCategory = (typeof ORG_CATEGORIES)[number];

// ── Public: Tick ──────────────────────────────────────────────────────────────

export interface CommunityTickResult {
  settled:            number;
  orgs_founded:        number;
  clubs_founded:       number;
  org_joins:           number;
  club_joins:          number;
  club_departures:     number;
  neighborhoods_drifted: number;
}

export async function runCommunityTick(): Promise<CommunityTickResult> {
  const settled = await tickSettlement();
  const [orgsFounded, clubsFounded] = await Promise.all([tickOrgFounding(), tickClubFounding()]);
  const [orgJoins, clubResult] = await Promise.all([tickOrgMembership(), tickClubMembership()]);
  const neighborhoodsDrifted = await tickCohesionDrift();

  return {
    settled,
    orgs_founded:  orgsFounded,
    clubs_founded: clubsFounded,
    org_joins:     orgJoins,
    club_joins:    clubResult.joins,
    club_departures: clubResult.departures,
    neighborhoods_drifted: neighborhoodsDrifted,
  };
}

// ── 1. Settlement ─────────────────────────────────────────────────────────────

async function tickSettlement(): Promise<number> {
  const { data: unsettled, error } = await supabaseAdmin
    .from('characters')
    .select('id, companion_occupations(location_id)')
    .not('id', 'in', `(select character_id from neighborhood_residents)`)
    .limit(200);

  if (error || !unsettled?.length) return 0;

  let settled = 0;

  for (const character of unsettled) {
    const occupationLocationId = character.companion_occupations?.location_id ?? null;

    const neighborhood = await pickNeighborhood(occupationLocationId);
    if (!neighborhood) continue;

    const { error: insertError } = await supabaseAdmin
      .from('neighborhood_residents')
      .insert({ character_id: character.id, neighborhood_id: neighborhood.id });

    if (insertError) continue;

    await supabaseAdmin
      .from('neighborhoods')
      .update({ resident_count: neighborhood.resident_count + 1 })
      .eq('id', neighborhood.id);

    settled++;
  }

  return settled;
}

async function pickNeighborhood(preferredLocationId: string | null): Promise<{ id: string; resident_count: number } | null> {
  let query = supabaseAdmin.from('neighborhoods').select('id, resident_count');

  if (preferredLocationId) {
    const { data } = await query.eq('parent_location_id', preferredLocationId).limit(5);
    if (data?.length) return pick(data);
  }

  const { data: any_ } = await supabaseAdmin.from('neighborhoods').select('id, resident_count').limit(20);
  return any_?.length ? pick(any_) : null;
}

// ── 2. Founding ────────────────────────────────────────────────────────────────

async function tickOrgFounding(): Promise<number> {
  const { data: candidates, error } = await supabaseAdmin
    .from('companion_occupations')
    .select(`
      character_id, location_id,
      occupation:occupations(title, prestige),
      character:characters(name)
    `)
    .not('location_id', 'is', null)
    .limit(300);

  if (error || !candidates) return 0;

  let founded = 0;

  for (const row of candidates) {
    if (Math.random() > ORG_FOUNDING_CHANCE_PER_TICK) continue;

    const prestige = row.occupation?.prestige ?? 0;
    if (prestige < MIN_PRESTIGE_TO_FOUND_ORG) continue;
    if (!row.character || !row.location_id) continue;

    const { data: alreadyFounded } = await supabaseAdmin
      .from('community_organizations')
      .select('id')
      .eq('founder_character_id', row.character_id)
      .eq('status', 'active')
      .maybeSingle();
    if (alreadyFounded) continue;

    const category = pick(ORG_CATEGORIES);
    const name = organizationName(category, (row.character as unknown as CharacterNameEmbed).name);

    const { data: org, error: createError } = await supabaseAdmin
      .from('community_organizations')
      .insert({
        name,
        slug: slugify(name),
        mission: organizationMission(category),
        category,
        location_id: row.location_id,
        founder_character_id: row.character_id,
        influence: 20 + Math.floor(Math.random() * 15),
      })
      .select('id')
      .single();

    if (createError || !org) continue;

    await supabaseAdmin.from('community_organization_memberships').insert({
      character_id: row.character_id,
      organization_id: org.id,
      role: 'founder',
    });
    await supabaseAdmin.from('community_organizations').update({ member_count: 1 }).eq('id', org.id);

    await logOfflineEntry(
      row.character_id,
      'goal_progress',
      `Founded ${name}, a new ${category} organization.`,
      { emotionalTone: 'proud' },
    );

    founded++;
  }

  return founded;
}

async function tickClubFounding(): Promise<number> {
  const { data: candidates, error } = await supabaseAdmin
    .from('characters')
    .select('id, name, tags, location:companion_occupations(location_id)')
    .limit(300);

  if (error || !candidates) return 0;

  let founded = 0;

  for (const character of candidates) {
    if (Math.random() > CLUB_FOUNDING_CHANCE_PER_TICK) continue;
    if (!character.tags?.length) continue;

    const interestTag = pick(character.tags);
    const locationId = (character as unknown as LocationAliasEmbed).location?.[0]?.location_id ?? null;

    const { data: existingClub } = await supabaseAdmin
      .from('clubs')
      .select('id')
      .eq('interest_tag', interestTag)
      .eq('status', 'active')
      .maybeSingle();
    if (existingClub) continue; // one active club per interest tag is enough; join instead of duplicating

    const name = clubName(interestTag);

    const { data: club, error: createError } = await supabaseAdmin
      .from('clubs')
      .insert({
        name,
        slug: slugify(name),
        interest_tag: interestTag,
        description: `A casual group for people who care about ${interestTag}.`,
        location_id: locationId,
        founder_character_id: character.id,
      })
      .select('id')
      .single();

    if (createError || !club) continue;

    await supabaseAdmin.from('club_memberships').insert({
      character_id: character.id,
      club_id: club.id,
      role: 'founder',
    });
    await supabaseAdmin.from('clubs').update({ member_count: 1 }).eq('id', club.id);

    founded++;
  }

  return founded;
}

// ── 3. Membership ──────────────────────────────────────────────────────────────

async function tickOrgMembership(): Promise<number> {
  const { data: orgs, error } = await supabaseAdmin
    .from('community_organizations')
    .select('id, location_id, member_count, influence')
    .eq('status', 'active')
    .limit(200);

  if (error || !orgs?.length) return 0;

  let joins = 0;

  for (const org of orgs) {
    if (Math.random() > ORG_JOIN_CHANCE_PER_TICK) continue;

    const candidate = await findUnaffiliatedCharacter('community_organization_memberships', org.location_id);
    if (!candidate) continue;

    const { error: joinError } = await supabaseAdmin
      .from('community_organization_memberships')
      .insert({ character_id: candidate.id, organization_id: org.id });
    if (joinError) continue;

    await supabaseAdmin
      .from('community_organizations')
      .update({
        member_count: org.member_count + 1,
        influence: Math.min(100, org.influence + Math.floor(Math.random() * MAX_ORG_INFLUENCE_GAIN)),
      })
      .eq('id', org.id);

    joins++;
  }

  return joins;
}

async function tickClubMembership(): Promise<{ joins: number; departures: number }> {
  const { data: clubs, error } = await supabaseAdmin
    .from('clubs')
    .select('id, location_id, member_count, member_cap, interest_tag')
    .eq('status', 'active')
    .limit(200);

  if (error || !clubs?.length) return { joins: 0, departures: 0 };

  let joins = 0;
  let departures = 0;

  for (const club of clubs) {
    // Joins: prefer characters whose tags match the club's interest_tag.
    if (club.member_count < club.member_cap && Math.random() <= CLUB_JOIN_CHANCE_PER_TICK) {
      const candidate = await findInterestedCharacter(club.interest_tag, club.location_id);
      if (candidate) {
        const { error: joinError } = await supabaseAdmin
          .from('club_memberships')
          .insert({ character_id: candidate.id, club_id: club.id });
        if (!joinError) {
          await supabaseAdmin.from('clubs').update({ member_count: club.member_count + 1 }).eq('id', club.id);
          joins++;
        }
      }
    }

    // Departures: occasional attrition, never below the founder.
    if (club.member_count > 1 && Math.random() <= CLUB_ATTRITION_CHANCE_PER_TICK) {
      const { data: leaver } = await supabaseAdmin
        .from('club_memberships')
        .select('id')
        .eq('club_id', club.id)
        .neq('role', 'founder')
        .limit(1)
        .maybeSingle();

      if (leaver) {
        await supabaseAdmin.from('club_memberships').delete().eq('id', leaver.id);
        await supabaseAdmin
          .from('clubs')
          .update({ member_count: Math.max(1, club.member_count - 1) })
          .eq('id', club.id);
        departures++;
      }
    }
  }

  return { joins, departures };
}

async function findUnaffiliatedCharacter(
  membershipTable: 'community_organization_memberships' | 'club_memberships',
  locationId: string | null,
): Promise<{ id: string } | null> {
  let query = supabaseAdmin
    .from('characters')
    .select('id, companion_occupations(location_id)')
    .not('id', 'in', `(select character_id from ${membershipTable})`)
    .limit(50);

  const { data } = await query;
  if (!data?.length) return null;

  if (locationId) {
    const local = data.filter((c) => c.companion_occupations?.location_id === locationId);
    if (local.length) return pick(local);
  }
  return pick(data);
}

async function findInterestedCharacter(interestTag: string, locationId: string | null): Promise<{ id: string } | null> {
  const { data } = await supabaseAdmin
    .from('characters')
    .select('id, tags, companion_occupations(location_id)')
    .contains('tags', [interestTag])
    .not('id', 'in', `(select character_id from club_memberships where club_id is not null)`)
    .limit(50);

  if (!data?.length) return null;
  if (locationId) {
    const local = data.filter((c) => c.companion_occupations?.location_id === locationId);
    if (local.length) return pick(local);
  }
  return pick(data);
}

// ── 4. Cohesion drift ──────────────────────────────────────────────────────────

async function tickCohesionDrift(): Promise<number> {
  const { data: neighborhoods, error } = await supabaseAdmin
    .from('neighborhoods')
    .select('id, cohesion, parent_location_id')
    .limit(200);

  if (error || !neighborhoods?.length) return 0;

  let drifted = 0;

  for (const n of neighborhoods) {
    const { data: gov } = await supabaseAdmin
      .from('city_governance')
      .select('stability')
      .eq('location_id', n.parent_location_id)
      .maybeSingle();

    const stability = gov?.stability ?? 50;
    const bias = (stability - 50) * COHESION_DRIFT_RATE;
    const random = (Math.random() - 0.5) * 4;
    const delta = Math.round(bias + random);
    if (delta === 0) continue;

    const nextCohesion = clamp(n.cohesion + delta, 0, 100);
    await supabaseAdmin.from('neighborhoods').update({ cohesion: nextCohesion }).eq('id', n.id);
    drifted++;
  }

  return drifted;
}

// ── Prompt context ─────────────────────────────────────────────────────────────

export async function formatCommunityForPrompt(characterId: string): Promise<string> {
  const [{ data: residence }, { data: orgMemberships }, { data: clubMemberships }] = await Promise.all([
    supabaseAdmin
      .from('neighborhood_residents')
      .select('neighborhood:neighborhoods(name, vibe, cohesion)')
      .eq('character_id', characterId)
      .maybeSingle(),
    supabaseAdmin
      .from('community_organization_memberships')
      .select('role, organization:organizations(name, mission)')
      .eq('character_id', characterId)
      .limit(3),
    supabaseAdmin
      .from('club_memberships')
      .select('role, club:clubs(name, interest_tag)')
      .eq('character_id', characterId)
      .limit(3),
  ]);

  const lines: string[] = [];

  const neighborhood = (residence as unknown as NeighborhoodEmbed | null)?.neighborhood;
  if (neighborhood) {
    lines.push(`[Neighborhood] You live in ${neighborhood.name} (${neighborhood.vibe}).`);
  }

  for (const m of orgMemberships ?? []) {
    const org = (m as unknown as OrganizationEmbed).organization;
    if (org) lines.push(`[Organization] ${m.role} of ${org.name} — ${org.mission}`);
  }

  for (const m of clubMemberships ?? []) {
    const club = (m as unknown as ClubEmbed).club;
    if (club) lines.push(`[Club] ${m.role} of ${club.name}, for people into ${club.interest_tag}.`);
  }

  return lines.join('\n');
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function organizationName(category: OrgCategory, founderName: string): string {
  const suffix: Record<OrgCategory, string> = {
    civic: 'Civic Council',
    labor: 'Workers Guild',
    charitable: 'Relief Fund',
    professional: 'Professional Association',
    advocacy: 'Action Coalition',
    religious: 'Fellowship',
    academic: 'Society',
  };
  return `${founderName.split(' ')[0]}'s ${suffix[category]}`;
}

function organizationMission(category: OrgCategory): string {
  const missions: Record<OrgCategory, string> = {
    civic: 'Improving how the neighborhood governs itself, block by block.',
    labor: 'Protecting the interests of workers in the same trade.',
    charitable: 'Getting resources to people who need them, no questions asked.',
    professional: 'Standards and support for people in the same field.',
    advocacy: 'Pushing a specific cause into public conversation.',
    religious: 'A shared practice and community around a common faith.',
    academic: 'Serious study of a shared subject, outside any institution.',
  };
  return missions[category];
}

function clubName(interestTag: string): string {
  return `${capitalize(interestTag)} Club`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Math.random().toString(36).slice(2, 7);
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

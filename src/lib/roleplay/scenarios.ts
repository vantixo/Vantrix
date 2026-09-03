import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { getLocationResidents } from '@/lib/universe/world-atlas';
import type { RoleplayScenario, RoleplayTier } from '@/types/roleplay';

const SCENARIO_COLUMNS =
  'id, slug, title, tagline, genre, tags, premise, setting, tone, opening_narration, character_id, chapter_count, cover_image_url, min_tier, is_active, sort_order, like_count, dislike_count, location_slug, faction_slug';

/**
 * Minimal cast-member shape for the scenario-first companion picker
 * (/roleplay/new) and any other surface that just needs to render a tappable
 * character tile — not the full DiscoverCharacter shape.
 */
export interface ScenarioCastMember {
  id: string;
  name: string;
  image_url: string | null;
}

/** factions.slug set the given character belongs to — see faction_memberships. */
export async function getCharacterFactionSlugs(characterId: string): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin
    .from('faction_memberships')
    .select('faction:factions(slug)')
    .eq('character_id', characterId);

  if (error) {
    logger.warn('roleplay:scenarios:character-factions-failed', { error, characterId });
    return new Set();
  }

  return new Set(
    (data ?? [])
      .map(r => (r.faction as { slug: string } | null)?.slug)
      .filter((slug): slug is string => Boolean(slug)),
  );
}

/** world_locations.slug the given character lives/works in — see companion_occupations. */
export async function getCharacterLocationSlug(characterId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('companion_occupations')
    .select('location:world_locations(slug)')
    .eq('character_id', characterId)
    .maybeSingle();

  if (error) {
    logger.warn('roleplay:scenarios:character-location-failed', { error, characterId });
    return null;
  }

  return (data?.location as { slug: string } | null)?.slug ?? null;
}

/**
 * List active scenarios, optionally scoped to ones playable with a given
 * character (universal templates — character_id IS NULL — always included
 * alongside any character-specific ones for this character).
 *
 * AREA-RESTRICTION FIX: a scenario tied to a faction_slug/location_slug is
 * a scene about being *in that place* — it doesn't make sense with a
 * character who has no connection to it (see world-scenarios-section.tsx's
 * "Scenarios Here" — these were reachable from the Location/Faction page,
 * but the same scenario also always showed up in every OTHER character's
 * own Story Mode catalog with no tie to the place at all). Once a
 * characterId is known, faction/location-scoped rows are dropped unless
 * that character is actually a faction member / based in that location —
 * same spirit as the existing character_id mismatch filter just below,
 * just for a place instead of a specific character. Universal scenarios
 * (both slugs null) are unaffected. Costs at most two extra lookups, and
 * only runs at all when the catalog actually contains a scoped row.
 *
 * Does NOT filter by tier — the picker shows the full catalog with locked
 * cards for scenarios above the user's tier (same UX as MOOD_ROOMS), so the
 * user can see what premium unlocks. Enforcement happens in engine.ts at
 * session start, not here.
 */
export async function listScenarios(characterId?: string): Promise<RoleplayScenario[]> {
  let query = supabaseAdmin
    .from('roleplay_scenarios')
    .select(SCENARIO_COLUMNS)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  const { data, error } = await query;

  if (error) {
    logger.warn('roleplay:scenarios:list-failed', { error, characterId });
    return [];
  }

  const rows = (data ?? []) as RoleplayScenario[];
  if (!characterId) return rows;

  const forThisCharacter = rows.filter(s => s.character_id === null || s.character_id === characterId);

  const needsFactionCheck = forThisCharacter.some(s => s.faction_slug);
  const needsLocationCheck = forThisCharacter.some(s => s.location_slug);
  if (!needsFactionCheck && !needsLocationCheck) return forThisCharacter;

  const [factionSlugs, locationSlug] = await Promise.all([
    needsFactionCheck ? getCharacterFactionSlugs(characterId) : Promise.resolve(new Set<string>()),
    needsLocationCheck ? getCharacterLocationSlug(characterId) : Promise.resolve(null),
  ]);

  return forThisCharacter.filter(s => {
    if (s.faction_slug) return factionSlugs.has(s.faction_slug);
    if (s.location_slug) return s.location_slug === locationSlug;
    return true;
  });
}

/**
 * Cast for the scenario-first companion picker (/roleplay/new?scenario=).
 * Universal scenarios return `null` (no restriction — caller falls back to
 * the general discover pool). Faction/location-scoped scenarios return the
 * actual members/residents so "who do you want this story with" only ever
 * offers characters who plausibly belong in that scene — the picker
 * counterpart to listScenarios()'s catalog-side filter above.
 *
 * Falls back to `null` (unrestricted) if the scoped place currently has
 * zero eligible characters, rather than showing a dead-end "no companions"
 * screen — matches this codebase's general fail-soft convention (see
 * getLocationResidents's own parent-location fallback).
 */
export async function getEligibleCastForScenario(
  scenario: Pick<RoleplayScenario, 'faction_slug' | 'location_slug'>,
  limit = 24,
): Promise<{ cast: ScenarioCastMember[] | null; scopeLabel: string | null }> {
  if (scenario.faction_slug) {
    const { data: faction } = await supabaseAdmin
      .from('factions')
      .select('id, name')
      .eq('slug', scenario.faction_slug)
      .maybeSingle();
    if (!faction) return { cast: null, scopeLabel: null };

    const { data: memberships, error } = await supabaseAdmin
      .from('faction_memberships')
      .select('character:characters( id, name, image_url, active )')
      .eq('faction_id', faction.id)
      .eq('is_public', true)
      .limit(limit);

    if (error) logger.warn('roleplay:scenarios:eligible-cast-faction-failed', { error, factionSlug: scenario.faction_slug });

    const cast = (memberships ?? [])
      .map(m => m.character as { id: string; name: string; image_url: string | null; active: boolean | null } | null)
      .filter((c): c is NonNullable<typeof c> => !!c && c.active !== false)
      .map(({ id, name, image_url }) => ({ id, name, image_url }));

    return { cast: cast.length > 0 ? cast : null, scopeLabel: faction.name as string };
  }

  if (scenario.location_slug) {
    const { data: location } = await supabaseAdmin
      .from('world_locations')
      .select('id, name, parent_location_id')
      .eq('slug', scenario.location_slug)
      .maybeSingle();
    if (!location) return { cast: null, scopeLabel: null };

    const residents = await getLocationResidents(
      location.id as string,
      limit,
      (location.parent_location_id as string | null) ?? null,
    );
    const cast = residents.map(r => ({ id: r.id, name: r.name, image_url: r.image_url }));

    return { cast: cast.length > 0 ? cast : null, scopeLabel: location.name as string };
  }

  return { cast: null, scopeLabel: null };
}

/**
 * Looks up a scenario by its public slug rather than internal id — used by
 * the /roleplay/new companion-picker page, which is linked to from a
 * scenario slug (e.g. Home's Popular Scenarios tiles), not an id.
 */
export async function getScenarioBySlug(slug: string): Promise<RoleplayScenario | null> {
  const { data, error } = await supabaseAdmin
    .from('roleplay_scenarios')
    .select(SCENARIO_COLUMNS)
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle();

  if (error || !data) return null;
  return data as RoleplayScenario;
}

export async function getScenario(scenarioId: string): Promise<RoleplayScenario | null> {
  const { data, error } = await supabaseAdmin
    .from('roleplay_scenarios')
    .select(SCENARIO_COLUMNS)
    .eq('id', scenarioId)
    .eq('is_active', true)
    .maybeSingle();

  if (error || !data) return null;
  return data as RoleplayScenario;
}

export const ALWAYS_FREE_SCENARIO_SLUG = 'first-date';

export function isScenarioUnlockedForTier(scenario: RoleplayScenario, tier: RoleplayTier): boolean {
  return scenario.min_tier === 'free' || tier !== 'free';
}

/**
 * Scenarios scoped to a specific world location (World hub's Location
 * detail page's "Scenarios Here" section) — see
 * 20261124_roleplay_world_faction_scenarios.sql for the location_slug
 * column these filter on. Same shape/enforcement contract as
 * listScenarios(): unfiltered by tier, locked cards render client-side,
 * enforcement happens in engine.ts at session start.
 */
export async function listScenariosForLocation(locationSlug: string): Promise<RoleplayScenario[]> {
  const { data, error } = await supabaseAdmin
    .from('roleplay_scenarios')
    .select(SCENARIO_COLUMNS)
    .eq('is_active', true)
    .eq('location_slug', locationSlug)
    .order('sort_order', { ascending: true });

  if (error) {
    logger.warn('roleplay:scenarios:list-for-location-failed', { error, locationSlug });
    return [];
  }

  return (data ?? []) as RoleplayScenario[];
}

/** Faction counterpart to listScenariosForLocation() — see that function's doc comment. */
export async function listScenariosForFaction(factionSlug: string): Promise<RoleplayScenario[]> {
  const { data, error } = await supabaseAdmin
    .from('roleplay_scenarios')
    .select(SCENARIO_COLUMNS)
    .eq('is_active', true)
    .eq('faction_slug', factionSlug)
    .order('sort_order', { ascending: true });

  if (error) {
    logger.warn('roleplay:scenarios:list-for-faction-failed', { error, factionSlug });
    return [];
  }

  return (data ?? []) as RoleplayScenario[];
}

/**
 * Home's "Popular Scenarios" feed — the four hand-picked universal tiles
 * plus any newer scenario (universal or faction/location-scoped) the
 * catalog has picked up since, ordered the same way the picker orders
 * them (sort_order). Character-specific scenarios (character_id set) are
 * excluded — Home has no character context to hand off with them. This is
 * what lets a newly-added scenario (new migration, or later an admin tool)
 * show up on Home automatically instead of requiring a code change to the
 * hardcoded tile list every time — see popular-scenarios.tsx's own note on
 * why it moved off a static array.
 */
export async function listHomeScenarios(limit = 8): Promise<RoleplayScenario[]> {
  const { data, error } = await supabaseAdmin
    .from('roleplay_scenarios')
    .select(SCENARIO_COLUMNS)
    .eq('is_active', true)
    .is('character_id', null)
    .order('sort_order', { ascending: true })
    .limit(limit);

  if (error) {
    logger.warn('roleplay:scenarios:list-home-failed', { error });
    return [];
  }

  return (data ?? []) as RoleplayScenario[];
}

/**
 * Maps scenario_id -> the caller's current vote, for the given scenario ids.
 * Used to annotate the catalog response so the picker can render each
 * card's like/dislike buttons already in the right pressed state.
 */
export async function getScenarioVotesForUser(
  userId: string,
  scenarioIds: string[],
): Promise<Record<string, 'like' | 'dislike'>> {
  if (scenarioIds.length === 0) return {};

  const { data, error } = await supabaseAdmin
    .from('roleplay_scenario_votes')
    .select('scenario_id, vote_type')
    .eq('user_id', userId)
    .in('scenario_id', scenarioIds);

  if (error) {
    logger.warn('roleplay:scenario-votes:list-failed', { error, userId });
    return {};
  }

  return Object.fromEntries(
    (data ?? []).map(row => [row.scenario_id as string, row.vote_type as 'like' | 'dislike']),
  );
}

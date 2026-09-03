/**
 * World Atlas — Read-Aggregation Layer for the Universe Frontend
 *
 * "Nothing is forgotten" applies to data shape too — rather than letting
 * every page hand-assemble joins across locations, governance, economy,
 * factions, and characters, this module composes those tables into the
 * exact shapes the Universe frontend renders.
 *
 * Mirrors the existing read/write separation in this directory:
 * governance.ts, economy.ts, story-engine.ts, and event-engine.ts own the
 * simulation (the "write"/tick side); world-history.ts and this file are
 * the "read" side. No tick logic lives here.
 */

import { supabaseAdmin }        from '@/lib/supabase/admin';
import { getCityTimeline }      from './world-history';
import { getUniverseState }     from './world-engine';
import { getActiveWorldEvents } from './event-engine';
import { getActiveStories }     from './story-engine';
import { getSocialStatus, getLegend }   from './status-legend';
import { getCharacterAttributes }       from './character-evolution';
import { getReputation }                from './reputation';
import { getCompanionOccupation }       from './companion-jobs';
import { getSocialLinks }               from './social-graph';
import { getCharacterAssets }           from './scarcity';
import { getCharacterBiography }        from './world-history';
import { getCurrentWeather }            from './weather-engine';
import { getUnresolvedIncidents }       from './crime-engine';
import { getActiveCulturalTrends }      from './culture-engine';
import { getActiveReligiousEvents }     from './religion-engine';
import { getCurrentInflation }          from './inflation-engine';
import type { WorldLocation, CityCrisis } from '@/types/world-expansion';
import type { ScarceAsset } from '@/types/legacy-systems';
import type {
  WorldOverview, LocationSummary, LocationDetail, LocationResident,
  FactionSummary, FactionDetail, FactionMemberRow, CharacterWorldProfile,
} from '@/types/universe-views';
import { redis }              from '@/lib/redis';

const CACHE = {
  locations: 'vantrix:atlas:locations',
  factions:  'vantrix:atlas:factions',
};
const TTL = 300; // 5 min — atlas data drifts slowly (governance/economy ticks)

// ── World Overview ────────────────────────────────────────────────────────────

/**
 * Composes universe state, active world events, and ongoing stories into
 * the single payload the Universe hub page needs.
 */
export async function getWorldOverview(): Promise<WorldOverview> {
  const [state, events, stories] = await Promise.all([
    getUniverseState(),
    getActiveWorldEvents(8),
    getActiveStories(),
  ]);
  return { state, events, stories };
}

// ── Locations ──────────────────────────────────────────────────────────────────

export async function getAllLocations(): Promise<LocationSummary[]> {
  try {
    const cached = await redis.get<LocationSummary[]>(CACHE.locations);
    if (cached) return cached;
  } catch { /* ok */ }

  const { data: locations, error } = await supabaseAdmin
    .from('world_locations')
    .select('*')
    .order('is_capital', { ascending: false })
    .order('population', { ascending: false });

  if (error || !locations) return [];

  const [{ data: governance }, { data: economies }, { data: factions }] = await Promise.all([
    supabaseAdmin.from('city_governance').select('location_id, approval_rating, stability, corruption, government_type'),
    supabaseAdmin.from('location_economy').select('location_id, gdp, unemployment, primary_industry'),
    supabaseAdmin.from('factions').select('location_id'),
  ]);

  const govByLoc  = new Map((governance ?? []).map((g) => [g.location_id as string, g]));
  const econByLoc = new Map((economies  ?? []).map((e) => [e.location_id as string, e]));

  const factionCountByLoc = new Map<string, number>();
  for (const f of (factions ?? []) as { location_id: string | null }[]) {
    if (!f.location_id) continue;
    factionCountByLoc.set(f.location_id, (factionCountByLoc.get(f.location_id) ?? 0) + 1);
  }

  const summaries: LocationSummary[] = (locations as WorldLocation[]).map((loc) => ({
    ...loc,
    governance:    govByLoc.get(loc.id) ?? null,
    economy:       econByLoc.get(loc.id) ?? null,
    faction_count: factionCountByLoc.get(loc.id) ?? 0,
  }));

  try { await redis.set(CACHE.locations, summaries, { ex: TTL }); } catch { /* ok */ }
  return summaries;
}

/**
 * Real location photography, keyed by id — deliberately not routed
 * through getAllLocations() above: that call also joins governance/
 * economy/faction-count for every location in the world (~30-40 rows),
 * which is wasted work for a caller that only ever needs one or two
 * image_url values (Home's "Your World" strip — see getHomeWorldTeaser
 * in lib/frontend/world.ts). A plain `.in('id', ids)` id/image select
 * instead, same "fetch only what this surface renders" principle the
 * rest of this file already follows.
 */
export async function getLocationImages(ids: string[]): Promise<Map<string, string | null>> {
  const uniqueIds = Array.from(new Set(ids)).filter(Boolean);
  if (uniqueIds.length === 0) return new Map();

  const { data, error } = await supabaseAdmin
    .from('world_locations')
    .select('id, image_url')
    .in('id', uniqueIds);

  if (error || !data) return new Map();

  return new Map(data.map((row) => [row.id as string, (row.image_url as string | null) ?? null]));
}

// Residents of a location — every character whose home location
// (companion_occupations.location_id, seeded by provisioning.ts and
// editable per-character) points here. This is the source of truth for
// "who actually lives/works in this city," and is what scopes both the
// Residents section and the Scene Builder's cast picker to a unique,
// per-world roster instead of the entire platform's character list.
//
// Sub-districts (e.g. the Archive's Wings, via parent_location_id) inherit
// their parent's residents as a fallback: a Wing's own directly-assigned
// residents are always listed first, and the parent's are appended (up to
// `limit`, de-duplicated) so a sub-district with nobody assigned yet still
// renders a populated Residents section / Scene Builder cast instead of an
// empty one. This never removes a location's own residents — it only adds.
async function fetchResidentsForLocation(locationId: string, limit: number): Promise<LocationResident[]> {
  const { data: occupations, error } = await supabaseAdmin
    .from('companion_occupations')
    .select('character_id, employer, character:characters( id, name, image_url, occupation, active )')
    .eq('location_id', locationId)
    .limit(limit);

  if (error || !occupations) return [];

  return occupations
    .map((row) => {
      const c = row.character as { id: string; name: string; image_url: string | null; occupation: string | null; active: boolean | null } | null;
      if (!c || c.active === false) return null;
      return {
        id:         c.id,
        name:       c.name,
        image_url:  c.image_url,
        occupation: c.occupation,
        employer:   (row as { employer: string | null }).employer ?? null,
      };
    })
    .filter((r): r is LocationResident => r !== null);
}

export async function getLocationResidents(
  locationId: string,
  limit = 60,
  parentLocationId?: string | null,
): Promise<LocationResident[]> {
  const own = await fetchResidentsForLocation(locationId, limit);

  if (!parentLocationId || own.length >= limit) return own;

  const inherited = await fetchResidentsForLocation(parentLocationId, limit - own.length);
  const seen = new Set(own.map((r) => r.id));
  const merged = [...own, ...inherited.filter((r) => !seen.has(r.id))];

  return merged;
}

export async function getLocationBySlug(slug: string): Promise<LocationDetail | null> {
  const { data: location, error } = await supabaseAdmin
    .from('world_locations')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();

  if (error || !location) return null;

  const [
    { data: governance },
    { data: economy },
    { data: factionsRaw },
    { data: assets },
    history,
    residents,
    weather,
    crimeIncidents,
    culturalTrends,
    religiousEvents,
    inflation,
    scenes,
  ] = await Promise.all([
    supabaseAdmin.from('city_governance').select('*').eq('location_id', location.id).maybeSingle(),
    supabaseAdmin.from('location_economy').select('*').eq('location_id', location.id).maybeSingle(),
    supabaseAdmin.from('factions').select('id, name, slug, ideology, influence, is_ruling, motto, sigil_description').eq('location_id', location.id),
    supabaseAdmin.from('scarce_assets').select('*, holder:characters( id, name, image_url )').eq('location_id', location.id),
    getCityTimeline(location.id, 20),
    getLocationResidents(location.id, 60, (location as WorldLocation).parent_location_id ?? null),
    // "Right now" ambiance — same location-scoped engines already wired
    // into the AI prompt (weather-engine.ts, crime-engine.ts,
    // culture-engine.ts, religion-engine.ts, inflation-engine.ts) but,
    // until now, with zero user-facing surface: a visitor to this page
    // had no way to see what characters chatting from here already know.
    getCurrentWeather(location.id),
    getUnresolvedIncidents(location.id, 3),
    getActiveCulturalTrends(location.id, 3),
    getActiveReligiousEvents(location.id, 2),
    getCurrentInflation(location.id),
    // Previously-generated Scene Builder output for this location — see
    // "Location Scenes" section below. composeUniverseScene/POST+GET
    // /api/universe/scenes were fully built with zero page anywhere
    // calling them (FRONTEND_WIRING_SWEEP_2026-08-20.md item #1); this is
    // that missing frontend read, sharing the same cache key/TTL as the
    // HTTP route so an SSR load and a client refresh agree.
    getScenesForLocation(slug),
  ]);

  // Active crisis + diplomatic standing with neighboring cities — both
  // engines (crisis.ts, diplomacy.ts) write these every tick but had no
  // frontend read path at all; see FRONTEND_WIRING_SWEEP note above.
  const [{ data: crisis }, { data: diplomacyRaw }] = await Promise.all([
    supabaseAdmin
      .from('city_crises')
      .select('*')
      .eq('location_id', location.id)
      .eq('status', 'active')
      .maybeSingle(),
    supabaseAdmin
      .from('diplomatic_relations')
      .select('id, standing, status, updated_at, location_a_id, location_b_id, a:world_locations!diplomatic_relations_location_a_id_fkey(id, name, slug), b:world_locations!diplomatic_relations_location_b_id_fkey(id, name, slug)')
      .or(`location_a_id.eq.${location.id},location_b_id.eq.${location.id}`)
      .order('updated_at', { ascending: false }),
  ]);

  const diplomacy = (diplomacyRaw ?? []).map((rel) => {
    const isA = rel.location_a_id === location.id;
    const other = (isA ? rel.b : rel.a) as { id: string; name: string; slug: string } | null;
    return {
      id: rel.id,
      standing: rel.standing,
      status: rel.status,
      updated_at: rel.updated_at,
      other_location: other ?? null,
    };
  });

  let leader: { id: string; name: string; image_url: string } | null = null;
  if (governance?.leader_character_id) {
    const { data: leaderChar } = await supabaseAdmin
      .from('characters')
      .select('id, name, image_url')
      .eq('id', governance.leader_character_id)
      .maybeSingle();
    leader = leaderChar ?? null;
  }

  const factionIds = (factionsRaw ?? []).map((f) => f.id as string);
  const memberCounts = new Map<string, number>();
  if (factionIds.length) {
    const { data: memberships } = await supabaseAdmin
      .from('faction_memberships')
      .select('faction_id')
      .in('faction_id', factionIds);
    for (const m of memberships ?? []) {
      memberCounts.set(m.faction_id, (memberCounts.get(m.faction_id) ?? 0) + 1);
    }
  }

  return {
    ...(location as WorldLocation),
    governance: governance ?? null,
    economy:    economy ?? null,
    leader,
    laws:       governance?.laws ?? [],
    factions:   (factionsRaw ?? []).map((f) => ({ ...f, member_count: memberCounts.get(f.id) ?? 0 })),
    assets:     (assets ?? []) as ScarceAsset[],
    faction_count: factionIds.length,
    history,
    residents,
    scenes,
    pulse: {
      weather:  weather ? { description: weather.description, recorded_at: weather.created_at } : null,
      crime:    (crimeIncidents ?? []).map((e) => ({ title: e.title, description: e.description })),
      culture:  (culturalTrends ?? []).map((e) => ({ title: e.title, description: e.description })),
      religion: (religiousEvents ?? []).map((e) => ({ title: e.title, description: e.description })),
      inflation: inflation ? { cpi: inflation.cpi, inflation_rate: inflation.inflation_rate } : null,
    },
    crisis: (crisis as CityCrisis | null) ?? null,
    diplomacy: diplomacy as LocationDetail['diplomacy'],
  };
}

// ── Factions ───────────────────────────────────────────────────────────────────

export async function getAllFactions(): Promise<FactionSummary[]> {
  try {
    const cached = await redis.get<FactionSummary[]>(CACHE.factions);
    if (cached) return cached;
  } catch { /* ok */ }

  const { data: factions, error } = await supabaseAdmin
    .from('factions')
    .select('*, location:world_locations( id, name, slug )')
    .order('influence', { ascending: false });

  if (error || !factions) return [];

  const factionIds = factions.map((f) => f.id as string);
  const memberCounts = new Map<string, number>();
  if (factionIds.length) {
    const { data: memberships } = await supabaseAdmin
      .from('faction_memberships')
      .select('faction_id')
      .in('faction_id', factionIds);
    for (const m of memberships ?? []) {
      memberCounts.set(m.faction_id, (memberCounts.get(m.faction_id) ?? 0) + 1);
    }
  }

  const summaries: FactionSummary[] = factions.map((f) => ({
    ...f,
    member_count: memberCounts.get(f.id) ?? 0,
  }));

  try { await redis.set(CACHE.factions, summaries, { ex: TTL }); } catch { /* ok */ }
  return summaries;
}

export async function getFactionBySlug(slug: string): Promise<FactionDetail | null> {
  const { data: faction, error } = await supabaseAdmin
    .from('factions')
    .select('*, location:world_locations( id, name, slug )')
    .eq('slug', slug)
    .maybeSingle();

  if (error || !faction) return null;

  const { data: memberships } = await supabaseAdmin
    .from('faction_memberships')
    .select('character_id, role, is_public, joined_at, character:characters( id, name, image_url )')
    .eq('faction_id', faction.id)
    .order('joined_at', { ascending: true });

  const memberIds = (memberships ?? []).map((m) => m.character_id as string);
  const tierByChar = new Map<string, string>();
  if (memberIds.length) {
    const { data: statuses } = await supabaseAdmin
      .from('social_status')
      .select('character_id, status_tier')
      .in('character_id', memberIds);
    for (const s of statuses ?? []) tierByChar.set(s.character_id, s.status_tier);
  }

  const members: FactionMemberRow[] = (memberships ?? []).map((m) => ({
    character_id: m.character_id,
    role:         m.role,
    is_public:    m.is_public,
    joined_at:    m.joined_at,
    character:    (m.character as { id: string; name: string; image_url: string } | null) ?? null,
    status_tier:  tierByChar.get(m.character_id) ?? null,
  }));

  // Recent influence/ruling-change history — written by
  // faction-evolution.ts every faction_evolve tick, whose own doc comment
  // names "the faction detail view" as the intended reader; never wired.
  const { data: evolutionLog } = await supabaseAdmin
    .from('faction_evolution_log')
    .select('*')
    .eq('faction_id', faction.id)
    .order('created_at', { ascending: false })
    .limit(15);

  return {
    ...faction,
    member_count: members.length,
    members,
    evolution_log: evolutionLog ?? [],
  } as FactionDetail;
}

// ── Character World Profile ─────────────────────────────────────────────────────

/**
 * Aggregates every legacy-systems / world-expansion engine's read state for
 * a single character into one payload — the "Living World" view shown on a
 * companion's World Profile page and embedded into the chat insights panel.
 */
export async function getCharacterWorldProfile(characterId: string): Promise<CharacterWorldProfile> {
  const [status, legend, attributes, reputation, occupation, social_links, assets, biography] = await Promise.all([
    getSocialStatus(characterId),
    getLegend(characterId),
    getCharacterAttributes(characterId),
    getReputation(characterId),
    getCompanionOccupation(characterId),
    getSocialLinks(characterId),
    getCharacterAssets(characterId),
    getCharacterBiography(characterId, 10),
  ]);

  return {
    character_id: characterId,
    status, legend, attributes, reputation, occupation, social_links, assets, biography,
  };
}

// ── Location Scenes ─────────────────────────────────────────────────────────

export interface LocationScene {
  id: string;
  genre: string;
  image_url: string | null;
  video_url: string | null;
  status: string;
  created_at: string;
  faction_id: string | null;
  character_ids: string[];
}

const scenesCacheKey = (locationSlug: string) => `vantrix:universe:scenes:${locationSlug}`;
const SCENES_TTL = 60; // short — scene generation can complete moments after page load

/**
 * Previously generated scenes for a location, newest first. Same cache
 * key/TTL as GET /api/universe/scenes so a page-load and a client-side
 * refresh via that route share one cache entry instead of two.
 */
export async function getScenesForLocation(locationSlug: string): Promise<LocationScene[]> {
  const cacheKey = scenesCacheKey(locationSlug);
  try {
    const cached = await redis.get<{ scenes: LocationScene[] }>(cacheKey);
    if (cached) return cached.scenes;
  } catch { /* cache miss/unavailable — fall through to DB */ }

  const { data: loc } = await supabaseAdmin.from('world_locations').select('id').eq('slug', locationSlug).maybeSingle();
  if (!loc) return [];

  const { data, error } = await supabaseAdmin
    .from('universe_scenes')
    // faction_id + character_ids added alongside the original four display
    // columns so the Scene Gallery can show cast avatars and a faction tie-in
    // badge on first paint (from the server component) instead of only after
    // a client-side GET /api/universe/scenes refetch — that route already
    // selects both (see api/universe/scenes/route.ts), this just brings the
    // SSR read path to parity with it.
    .select('id, genre, image_url, video_url, status, created_at, faction_id, character_ids')
    .eq('location_id', loc.id)
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) return [];

  const scenes = data ?? [];
  try { await redis.set(cacheKey, { scenes }, { ex: SCENES_TTL }); } catch { /* ok */ }
  return scenes;
}

// ── Featured Scenes (cross-world highlight reel for Home) ──────────────────

export interface FeaturedScene {
  id: string;
  genre: string;
  image_url: string | null;
  video_url: string | null;
  created_at: string;
  location: { slug: string; name: string; is_capital: boolean };
  faction: { name: string } | null;
  cast: { id: string; name: string; image_url: string | null }[];
}

const FEATURED_SCENES_CACHE_KEY = 'vantrix:atlas:featured-scenes';
const FEATURED_SCENES_TTL = 120; // between SCENES_TTL (60) and atlas TTL (300) — a cross-world
// row changes less often than one location's own gallery, but should still
// pick up a fresh legendary scene reasonably soon after it's composed.
const FEATURED_SCENES_POOL = 60; // candidates scored client-of-this-function-side before slicing to `limit`

/**
 * "Special and most valuable" scenes across every world, for Home's
 * highlight row. There's no likes/views column on `universe_scenes` (see
 * its migration — RLS is public-read, but no engagement tracking exists
 * yet), so "valuable" is scored from what's already on the row instead of
 * a popularity metric that doesn't exist: a scene with a rendered video is
 * the single most expensive thing this platform generates (Kling video —
 * see PLATFORM_DAILY_VIDEO_BUDGET's own comment in env.ts calling it "the
 * most expensive per-call action in the app"), a faction tie-in means it's
 * anchored to real world lore rather than a one-off cast, capital cities
 * are the platform's flagship locations, and a larger cast is a harder
 * composite to render coherently (see scene-composer.ts's own doc comment
 * on why group scenes trade LoRA identity-lock for cast size). None of
 * this is a proxy for user preference — just production value — so this
 * is a "most impressive" reel, not a "trending" one.
 */
export async function getFeaturedUniverseScenes(limit = 12): Promise<FeaturedScene[]> {
  try {
    const cached = await redis.get<FeaturedScene[]>(FEATURED_SCENES_CACHE_KEY);
    if (cached) return cached.slice(0, limit);
  } catch { /* cache miss/unavailable — fall through to DB */ }

  const { data: scenes, error } = await supabaseAdmin
    .from('universe_scenes')
    .select('id, genre, image_url, video_url, faction_id, character_ids, created_at, location:world_locations(slug, name, is_capital)')
    .eq('status', 'complete')
    .not('image_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(FEATURED_SCENES_POOL);

  if (error || !scenes || scenes.length === 0) return [];

  const factionIds = [...new Set(scenes.map((s) => s.faction_id as string | null).filter((id): id is string => !!id))];
  const factionNameById = new Map<string, string>();
  if (factionIds.length) {
    const { data: factions } = await supabaseAdmin.from('factions').select('id, name').in('id', factionIds);
    for (const f of factions ?? []) factionNameById.set(f.id as string, f.name as string);
  }

  const allCharIds = [...new Set(scenes.flatMap((s) => (s.character_ids ?? []) as string[]))];
  const charById = new Map<string, { id: string; name: string; image_url: string | null }>();
  if (allCharIds.length) {
    const { data: chars } = await supabaseAdmin.from('characters').select('id, name, image_url').in('id', allCharIds);
    for (const c of (chars ?? []) as { id: string; name: string; image_url: string | null }[]) charById.set(c.id, c);
  }

  const ranked = scenes
    .map((s) => {
      const loc = s.location as { slug: string; name: string; is_capital: boolean } | null;
      if (!loc) return null; // location was deleted after the scene was made — nothing to link to
      const castIds = (s.character_ids ?? []) as string[];
      const score =
        (s.video_url ? 3 : 0) +
        (s.faction_id ? 1 : 0) +
        (loc.is_capital ? 1 : 0) +
        Math.min(castIds.length, 6) * 0.4;
      const scene: FeaturedScene = {
        id: s.id as string,
        genre: s.genre as string,
        image_url: s.image_url as string | null,
        video_url: s.video_url as string | null,
        created_at: s.created_at as string,
        location: loc,
        faction: s.faction_id ? { name: factionNameById.get(s.faction_id as string) ?? 'Unaffiliated' } : null,
        cast: castIds.map((id) => charById.get(id)).filter((c): c is { id: string; name: string; image_url: string | null } => !!c),
      };
      return { scene, score };
    })
    .filter((r): r is { scene: FeaturedScene; score: number } => r !== null)
    .sort((a, b) => b.score - a.score || (new Date(b.scene.created_at).getTime() - new Date(a.scene.created_at).getTime()))
    .map((r) => r.scene);

  try { await redis.set(FEATURED_SCENES_CACHE_KEY, ranked, { ex: FEATURED_SCENES_TTL }); } catch { /* ok */ }
  return ranked.slice(0, limit);
}

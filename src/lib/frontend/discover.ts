import "server-only";
import { fetchInternal } from "./api";

/**
 * Shapes mirror the JSON actually returned by GET /api/discover/featured
 * (mode=full) — see shapeChar() and the featured/avatars/experiences
 * mapping blocks in that route. Kept as a hand-written mirror rather than
 * inferred from the route module: the route lives in the `api` segment
 * and route handlers don't export their response types, and duplicating
 * a small interface here is cheaper than restructuring that file just to
 * share a type.
 */
export interface DiscoverCharacter {
  id: string;
  name: string;
  age: number | null;
  gender: string | null;
  description: string | null;
  image_url: string | null;
  tags: string[];
  is_premium: boolean;
  min_tier: string | null;
  is_new: boolean;
  is_live: boolean;
  tokens_cost: number | null;
  archetype: string | null;
  opening_line: string | null;
  like_count: number;
  follower_count: number;
  /** .glb/.gltf asset for the 3D portrait viewer — see character-3d.tsx.
   *  Null for effectively every character today (20261213_character_model_url.sql). */
  model_url: string | null;
  /** Drive the procedural 3D avatar tier (character-avatar-3d.tsx) when
   *  model_url is null — see lib/characters/appearance-colors.ts. */
  hair_color: string | null;
  eye_color: string | null;
  skin_tone: string | null;
  body_type: string | null;
  reason?: string;
}

export interface DiscoverFeaturedItem {
  id: string;
  title: string;
  subtitle: string;
  image: string | null;
  badge: "NEW" | "FEATURED";
  cta: string;
  characterId: string;
  /** Added for featured-showcase.tsx — same fields shapeChar() already
   *  gives DiscoverCharacter, mirrored here so the premium Home showcase
   *  can show real trait pills, engagement stats, and a premium badge. */
  tags: string[];
  archetype: string | null;
  likeCount: number;
  followerCount: number;
  isPremium: boolean;
  minTier: string | null;
}

export interface DiscoverExperience {
  id: string;
  title: string;
  subtitle: string;
  image: string | null;
  category: string;
  characterName: string;
  characterAge: number | null;
  isNew: boolean;
  isSeries: boolean;
  hasNewEpisode: boolean;
  characterId: string;
}

/**
 * Mirrors the `avatars` block the route already builds — see its own
 * "drive the status-ring story viewer" comment. That viewer never got
 * built on the frontend, and this shape never got added to
 * DiscoverHomeData, so the data was computed on every request and then
 * silently dropped before it reached a page. Adding it here is the fix.
 */
export interface DiscoverAvatar {
  id: string;
  name: string;
  image: string | null;
  isNew: boolean;
  isLive: boolean;
  videoUrl: string | null;
  introVideoUrl: string | null;
  galleryImageUrls: string[] | null;
  galleryVideoUrls: string[] | null;
}

export interface DiscoverHomeData {
  featured: DiscoverFeaturedItem[];
  experiences: DiscoverExperience[];
  allCharacters: DiscoverCharacter[];
  avatars: DiscoverAvatar[];
  hasMore: boolean;
}

const EMPTY_HOME: DiscoverHomeData = {
  featured: [],
  experiences: [],
  allCharacters: [],
  avatars: [],
  hasMore: false,
};

/**
 * Called once from the Home Server Component (§12 Phase 3). Fails soft to
 * an empty-but-valid shape — /api/discover/featured already degrades the
 * same way on its own internal errors (500 with empty arrays), so a
 * network-level failure on this hop should render the same "empty state"
 * UI rather than crashing the whole page via the route-group error
 * boundary.
 */
export async function getDiscoverHome(params?: {
  gender?: "female" | "male" | "anime";
}): Promise<DiscoverHomeData> {
  const qs = params?.gender ? `?gender=${params.gender}` : "";
  try {
    return await fetchInternal<DiscoverHomeData>(`/api/discover/featured${qs}`);
  } catch {
    return EMPTY_HOME;
  }
}

export interface DiscoverCharsPage {
  allCharacters: DiscoverCharacter[];
  hasMore: boolean;
}

/**
 * Characters browse page (§3, nav "Characters" item + Home's "View All" /
 * search-icon targets — all previously dead links, see the page's own
 * comment). Deliberately `mode=chars` against the SAME route as
 * getDiscoverHome rather than a new endpoint: that mode already exists
 * specifically for "tab switches and infinite scroll" per the route's own
 * docstring, so a dedicated browse/search page is exactly the second
 * caller that mode was built for, not a new one.
 */
export async function getDiscoverChars(params: {
  gender?: "female" | "male" | "anime";
  category?: string;
  offset?: number;
  limit?: number;
}): Promise<DiscoverCharsPage> {
  const sp = new URLSearchParams({ mode: "chars" });
  if (params.gender) sp.set("gender", params.gender);
  if (params.category) sp.set("category", params.category);
  sp.set("offset", String(params.offset ?? 0));
  sp.set("limit", String(params.limit ?? 40));

  try {
    const page = await fetchInternal<{
      allCharacters: DiscoverCharacter[];
      hasMore: boolean;
    }>(`/api/discover/featured?${sp.toString()}`);
    return { allCharacters: page.allCharacters, hasMore: page.hasMore };
  } catch {
    return { allCharacters: [], hasMore: false };
  }
}

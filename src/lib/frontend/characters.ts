import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchInternal } from "./api";
import type { DiscoverCharacter } from "./discover";

/**
 * GET /api/characters/[id] is creator-only (builder data — see that
 * route's own docstring: "public viewers use /discover queries
 * elsewhere"). There's no dedicated public detail route in §11's map, so
 * this mirrors CHAR_SELECT from /api/discover/featured/route.ts — the
 * same public-safe column allowlist already established there — rather
 * than a fresh guess at which columns are safe to expose to any viewer.
 *
 * P0-AGE-GATE-FIX: this previously did not apply the NSFW preference gate
 * (`nsfw_enabled` lookup + `.eq("is_nsfw", false)`) before returning a
 * character, and didn't even select `is_nsfw`, so the caller had no way
 * to gate on it either — a direct /characters/[id] URL could expose full
 * mature character metadata/image to any authenticated user, verified or
 * not. `is_nsfw` is now selected so the page (see
 * (app)/characters/[id]/page.tsx) can check it against
 * resolveNsfwDiscoveryAccess() before rendering. Visibility flags
 * (is_live/active/is_public) remain enforced here, same as discover.
 */
export interface CharacterDetail {
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
  is_nsfw: boolean;
  tokens_cost: number | null;
  archetype: string | null;
  opening_line: string | null;
  like_count: number;
  follower_count: number;
  intro_video_url: string | null;
  gallery_image_urls: string[];
  gallery_video_urls: string[];
  /** .glb/.gltf asset for the 3D portrait viewer — see character-3d.tsx and
   *  the 20261213_character_model_url.sql migration. Null for the vast
   *  majority of characters today; character-portrait-viewer.tsx falls
   *  back to the procedural CharacterAvatar3D (using the fields below),
   *  then the 2D LivingPortrait, whenever this is null. */
  model_url: string | null;
  /** Drive the procedural 3D avatar tier (character-avatar-3d.tsx) when
   *  model_url is null — see lib/characters/appearance-colors.ts. */
  hair_color: string | null;
  eye_color: string | null;
  skin_tone: string | null;
  body_type: string | null;
}

// GALLERY-WIRE: intro_video_url / gallery_image_urls / gallery_video_urls
// have existed on `characters` since 20260717_character_media_gallery.sql
// (and are populated — see the 20260725/20260726 backfill migrations) but
// were never selected here, so the detail page had no way to render them.
// These are the public gallery columns, not private_gallery_*, which stay
// admin-only per 20260720c's column-level REVOKE.
const CHAR_SELECT =
  "id,name,age,gender,description,image_url,tags,is_premium,min_tier,is_new,is_live,is_nsfw,tokens_cost,archetype,opening_line,like_count,follower_count,intro_video_url,gallery_image_urls,gallery_video_urls,model_url,hair_color,eye_color,skin_tone,body_type";

export async function getCharacterDetail(
  id: string
): Promise<CharacterDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("characters")
    .select(CHAR_SELECT)
    .eq("id", id)
    .eq("is_live", true)
    .eq("active", true)
    .eq("is_public", true)
    .maybeSingle();

  if (!data) return null;
  const row = data as CharacterDetail;
  // DB default is '{}' (empty array) for both, but normalize defensively
  // in case a row was written before the 20260717 migration's default
  // applied, or via a path that set the column to NULL directly.
  return {
    ...row,
    gallery_image_urls: row.gallery_image_urls ?? [],
    gallery_video_urls: row.gallery_video_urls ?? [],
  };
}

/**
 * Characters browse page + top-bar search icon (both previously dead
 * links). GET /api/characters is the better fit here than
 * discover/featured's mode=chars: it's the one route in §11 that
 * actually supports a `q` name search, which is the point of a browse/
 * search page — discover/featured's grid mode has no search param (see
 * that route's own docstring), only gender/category/offset. Its `category`
 * param is a pre-existing naming quirk in that route (it filters the
 * `gender` column, not a true category) — kept as-is rather than
 * "fixed" here, since renaming it would mean editing the route's
 * validated contract, out of scope for a frontend build.
 *
 * The response shape is a strict superset of DiscoverCharacter (same
 * columns plus a few this page doesn't use), so it's reused directly
 * rather than declaring a near-duplicate type.
 */
export async function searchCharacters(params: {
  q?: string;
  gender?: "female" | "male" | "anime";
  limit?: number;
}): Promise<DiscoverCharacter[]> {
  const sp = new URLSearchParams();
  if (params.q?.trim()) sp.set("q", params.q.trim());
  if (params.gender) sp.set("category", params.gender);
  sp.set("limit", String(params.limit ?? 60));

  try {
    const body = await fetchInternal<{ characters: DiscoverCharacter[] }>(
      `/api/characters?${sp.toString()}`
    );
    return body.characters ?? [];
  } catch {
    return [];
  }
}

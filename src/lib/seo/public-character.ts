import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * §2.5 — public, crawlable character pages.
 *
 * GET /api/characters/:id is owner-only by design (see that route's own
 * docstring: "public viewers use /discover queries elsewhere"), and the
 * `characters_read` RLS policy (active = TRUE AND moderation_status =
 * 'approved') never learned about the later `is_public` column added in
 * 20260623_character_activation_and_visibility.sql — it's the ANON-key
 * guest client that's supposed to gate on is_public, not RLS, and every
 * existing anon caller (discover/featured, dating pools) already adds
 * `.eq("is_public", true)` by hand for exactly that reason. This file is
 * a new anon-reachable surface for that same "public" character subset,
 * so it uses supabaseAdmin (bypasses RLS entirely) and applies the full
 * explicit filter set itself rather than leaning on a policy that would
 * silently under-gate it if RLS were ever relied on alone:
 * active, is_public, is_live, moderation_status = 'approved', and
 * is_nsfw = false (a crawler/anonymous visitor never gets NSFW content —
 * there's no session here to apply resolveNsfwDiscoveryAccess() against).
 */

export interface PublicCharacter {
  id: string;
  name: string;
  age: number | null;
  gender: string | null;
  description: string | null;
  image_url: string | null;
  tags: string[];
  archetype: string | null;
  occupation: string | null;
  category: string | null;
  opening_line: string | null;
  like_count: number;
  follower_count: number;
  created_at: string;
}

const PUBLIC_CHAR_SELECT =
  "id,name,age,gender,description,image_url,tags,archetype,occupation,category,opening_line,like_count,follower_count,created_at";

function isPublicRow(row: {
  active: boolean;
  is_public: boolean;
  is_live: boolean | null;
  moderation_status: string;
  is_nsfw: boolean;
}): boolean {
  return Boolean(
    row.active &&
    row.is_public &&
    row.is_live &&
    row.moderation_status === "approved" &&
    !row.is_nsfw
  );
}

export async function getPublicCharacter(
  id: string
): Promise<PublicCharacter | null> {
  const { data, error } = await supabaseAdmin
    .from("characters")
    .select(
      `${PUBLIC_CHAR_SELECT},active,is_public,is_live,moderation_status,is_nsfw`
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !data || !isPublicRow(data)) return null;

  const { active: _a, is_public: _p, is_live: _l, moderation_status: _m, is_nsfw: _n, ...pub } = data;
  return {
    ...pub,
    tags: pub.tags ?? [],
    // created_at is nullable at the DB-schema level, but every row reaching
    // this point is an active/public/live character, which always has one
    // set (DB default). Fall back defensively rather than widening the
    // public PublicCharacter#created_at type to string | null for callers.
    created_at: pub.created_at ?? new Date(0).toISOString(),
  };
}

/**
 * Used by generateStaticParams (build-time) and sitemap.ts. Capped —
 * these are the same two data-driven, no-second-file-to-remember
 * conventions sitemap.ts/robots.ts already use for LANDING_PAGES, applied
 * to a set that's an order of magnitude bigger and actually changes daily,
 * so an unbounded fetch here is the wrong default. 5,000 keeps the sitemap
 * (and the build-time static-param list) well under Google's 50k-URL/file
 * sitemap limit even after future landing/other-route entries are added,
 * while still covering the platform's realistic public-character count.
 */
const MAX_PUBLIC_CHARACTER_IDS = 5000;

export async function getPublicCharacterIds(): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("characters")
    .select("id")
    .eq("active", true)
    .eq("is_public", true)
    .eq("is_live", true)
    .eq("moderation_status", "approved")
    .eq("is_nsfw", false)
    .order("created_at", { ascending: false })
    .limit(MAX_PUBLIC_CHARACTER_IDS);

  if (error || !data) return [];
  return data.map((row) => row.id as string);
}

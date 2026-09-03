import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

/**
 * Real "trending" — what visitors have actually been clicking into over
 * the last TRENDING_WINDOW_HOURS (record_character_click() →
 * character_click_events, see the 20261123_character_click_tracking.sql
 * migration), counted in SQL by trending_character_ids() rather than
 * pulled row-by-row into the app — same "count in the DB" pattern as
 * chat_affinity_tags() in recommendations/engine.ts. This replaces the
 * old like_count-sort proxy (explore-characters.tsx used to just re-sort
 * whatever pool it already had by total likes, which rewards all-time
 * accumulation, not what's hot right now).
 *
 * Falls back to a chat_count/like_count-ordered pool wherever recent
 * click data runs out — first deploy (no clicks recorded yet), a slow
 * period, or just not enough distinct recently-clicked characters to
 * fill `limit`. The fallback only ever fills remaining slots; a
 * character with real recent click volume is never outranked by it.
 */

export interface TrendingCharacterRow {
  id: string;
  name: string;
  age: number | null;
  gender: string;
  description: string | null;
  image_url: string;
  tags: string[] | null;
  is_premium: boolean | null;
  min_tier: string | null;
  is_new: boolean | null;
  is_live: boolean | null;
  tokens_cost: number | null;
  archetype: string | null;
  opening_line: string | null;
  like_count: number;
  follower_count: number;
  chat_count: number;
  created_at: string | null;
}

/**
 * trending_character_ids()/record_character_click() are new RPCs not yet
 * reflected in the generated src/types/supabase.ts (which validates RPC
 * names against a closed union). Narrowed to just the `rpc` shape
 * actually used here rather than an `any` cast — same workaround
 * lib/admin/safe-rpc.ts already uses for the same reason — so a typo on
 * the client elsewhere is still caught by the compiler.
 */
type RpcCapable = {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
};

const TRENDING_WINDOW_HOURS = 48;
const CANDIDATE_POOL = 300; // rows pulled from trending_character_ids() before filtering by live/gender/nsfw

const CHAR_SELECT =
  "id,name,age,gender,description,image_url,tags,is_premium,min_tier,is_new,is_live,tokens_cost,archetype,opening_line,like_count,follower_count,chat_count,created_at";

export async function getTrendingCharacters(
  supabase: Awaited<ReturnType<typeof createClient>>,
  opts: { allowNsfw: boolean; gender?: string | null; limit: number },
): Promise<TrendingCharacterRow[]> {
  let clickRanked: { character_id: string; click_count: number }[] = [];
  try {
    const { data, error } = await (supabase as unknown as RpcCapable).rpc("trending_character_ids", {
      p_hours: TRENDING_WINDOW_HOURS,
      p_limit: CANDIDATE_POOL,
    });
    if (error) throw error;
    clickRanked = (data ?? []) as { character_id: string; click_count: number }[];
  } catch (err) {
    logger.warn("trending: click-rank RPC failed, using engagement fallback only", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const result: TrendingCharacterRow[] = [];
  const seen = new Set<string>();

  // ── Primary: characters with real recent click volume, in click order ──
  if (clickRanked.length > 0) {
    let q = supabase
      .from("characters")
      .select(CHAR_SELECT)
      .in("id", clickRanked.map((r) => r.character_id))
      .eq("is_live", true)
      .eq("active", true)
      .eq("is_public", true);
    if (!opts.allowNsfw) q = q.eq("is_nsfw", false);
    if (opts.gender && opts.gender !== "all") q = q.eq("gender", opts.gender);

    const { data: rows } = await q;
    const byId = new Map(
      ((rows ?? []) as unknown as TrendingCharacterRow[]).map((r) => [r.id, r] as const),
    );

    for (const { character_id } of clickRanked) {
      const row = byId.get(character_id);
      if (row && !seen.has(row.id)) {
        result.push(row);
        seen.add(row.id);
      }
      if (result.length >= opts.limit) break;
    }
  }

  // ── Fallback: fill remaining slots by standing engagement ───────────────
  if (result.length < opts.limit) {
    let q = supabase
      .from("characters")
      .select(CHAR_SELECT)
      .eq("is_live", true)
      .eq("active", true)
      .eq("is_public", true);
    if (!opts.allowNsfw) q = q.eq("is_nsfw", false);
    if (opts.gender && opts.gender !== "all") q = q.eq("gender", opts.gender);
    if (seen.size > 0) q = q.not("id", "in", `(${Array.from(seen).join(",")})`);

    // Chats started ranks above likes here — starting a chat is a
    // stronger "this got clicked and held attention" signal than a like
    // tap, closer in spirit to the click data this is standing in for.
    const { data: fallbackRows } = await q
      .order("chat_count", { ascending: false })
      .order("like_count", { ascending: false })
      .limit(opts.limit - result.length);

    for (const row of (fallbackRows ?? []) as unknown as TrendingCharacterRow[]) {
      if (!seen.has(row.id)) {
        result.push(row);
        seen.add(row.id);
      }
    }
  }

  return result.slice(0, opts.limit);
}

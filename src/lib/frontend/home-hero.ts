import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

/**
 * Home's premium hero band — the personalised greeting, the single
 * cinematic "continue your story" card, and its side stack ("Tonight's
 * match" / "Streak"). See hero-split.tsx / greeting.tsx for the
 * components this feeds.
 *
 * NOT-REUSING-getDatingWorldHome: lib/dating/get-world-home.ts already
 * computes a `tonightsMatch`, but that function's whole point is running
 * the full 30-candidate recommendations engine (lib/recommendations/
 * engine.ts) plus a once-a-day Redis pin — real work that's already paid
 * for once per user on the /dating page. Re-running it here would mean
 * every single Home load pays for a recommendation pass it never shows
 * (Home renders one match, not the ranked list). Home's "Tonight's
 * match" is a narrower, honest claim anyway — "your current best
 * connection" (existing dating_matches, highest bond_score) rather than
 * a fresh recommendation — so it doesn't need the recommendation engine
 * at all. Three single-table, indexed, `.limit()`-capped reads below,
 * run in parallel, same fail-soft-to-empty contract as getHomeContext.
 */
export interface HomeHeroTopMatch {
  matchId: string;
  compatibilityPct: number;
  matchTier: string;
  /** No milestone logged yet on this match — a real, cheap proxy for "new". */
  isNew: boolean;
  character: { id: string; name: string; image_url: string | null };
}

export interface HomeHeroStreak {
  current: number;
  longest: number;
}

export interface HomeHeroContext {
  displayName: string | null;
  streak: HomeHeroStreak | null;
  topMatch: HomeHeroTopMatch | null;
}

const EMPTY_HERO_CONTEXT: HomeHeroContext = {
  displayName: null,
  streak: null,
  topMatch: null,
};

interface ProfileNameRow {
  display_name: string | null;
  username: string | null;
}

interface StreakRow {
  current_streak: number;
  longest_streak: number;
}

interface TopMatchRow {
  id: string;
  compatibility_pct: number;
  match_tier: string;
  milestones: number;
  character: { id: string; name: string; image_url: string | null } | null;
}

export async function getHomeHeroContext(userId: string): Promise<HomeHeroContext> {
  try {
    const [profileRes, streakRes, matchRes] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("display_name, username")
        .eq("id", userId)
        .single(),
      supabaseAdmin
        .from("user_streaks")
        .select("current_streak, longest_streak")
        .eq("user_id", userId)
        .maybeSingle(),
      // Same "worth surfacing" bar get-world-home.ts already uses for its
      // relationships rail (bond_score >= 20) — a just-started match isn't
      // a meaningful "tonight's match" yet.
      supabaseAdmin
        .from("dating_matches")
        .select(
          "id, compatibility_pct, match_tier, milestones, character:characters!dating_matches_character_id_fkey ( id, name, image_url )"
        )
        .eq("user_id", userId)
        .gte("bond_score", 20)
        .order("bond_score", { ascending: false })
        .limit(1),
    ]);

    const profile = profileRes.data as ProfileNameRow | null;
    const streakRow = streakRes.data as StreakRow | null;
    const matchRow = (matchRes.data as TopMatchRow[] | null)?.[0] ?? null;

    const displayName = profile?.display_name || profile?.username || null;

    const streak: HomeHeroStreak | null =
      streakRow && streakRow.current_streak > 0
        ? { current: streakRow.current_streak, longest: streakRow.longest_streak }
        : null;

    const topMatch: HomeHeroTopMatch | null =
      matchRow && matchRow.character
        ? {
            matchId: matchRow.id,
            compatibilityPct: matchRow.compatibility_pct,
            matchTier: matchRow.match_tier,
            isNew: matchRow.milestones === 0,
            character: matchRow.character,
          }
        : null;

    return { displayName, streak, topMatch };
  } catch (error) {
    logger.error("getHomeHeroContext failed", { error: String(error) });
    return EMPTY_HERO_CONTEXT;
  }
}

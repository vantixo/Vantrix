import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOpsSnapshot, type OpsSnapshot } from "@/lib/admin/ops-snapshot";

export interface AdminStats {
  users: number;
  characters: number;
  conversations: number;
  ads: number;
  pendingCharacters: number;
  pendingSafetyReviews: number;
}

export interface RecentUser {
  id: string;
  username: string | null;
  tier: string;
  country: string | null;
  created_at: string | null;
  role: string | null;
}

/**
 * Mirrors GET /api/admin?resource=stats' four counts, plus two extra
 * counts (pending character moderation, open safety-queue rows) the
 * dashboard needs that the existing route doesn't return — queried
 * directly with supabaseAdmin rather than round-tripping through the
 * route, per FRONTEND_DIRECTIVE §10 (this Server Component already has
 * to call getOpsSnapshot() directly for the same reason the route's own
 * doc comment gives: avoid a self-referential HTTP hop).
 */
export async function getAdminOverview(): Promise<{
  stats: AdminStats;
  ops: OpsSnapshot;
  recentUsers: RecentUser[];
}> {
  const [
    { count: users },
    { count: characters },
    { count: conversations },
    { count: ads },
    { count: pendingCharacters },
    safetyCounts,
    { data: recentUsers },
    ops,
  ] = await Promise.all([
    supabaseAdmin.from("profiles").select("*", { count: "exact", head: true }),
    supabaseAdmin.from("characters").select("*", { count: "exact", head: true }),
    supabaseAdmin.from("conversations").select("*", { count: "exact", head: true }),
    supabaseAdmin.from("ads").select("*", { count: "exact", head: true }),
    supabaseAdmin
      .from("characters")
      .select("*", { count: "exact", head: true })
      .eq("moderation_status", "pending"),
    Promise.all([
      supabaseAdmin
        .from("abuse_signals")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending"),
      supabaseAdmin
        .from("crisis_events")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending"),
      supabaseAdmin
        .from("reply_guard_flags")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending"),
      supabaseAdmin
        .from("keyword_watch_hits")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending"),
    ]),
    supabaseAdmin
      .from("profiles")
      .select("id,username,tier,country,created_at,role")
      .order("created_at", { ascending: false })
      .limit(8),
    getOpsSnapshot(),
  ]);

  const pendingSafetyReviews = safetyCounts.reduce(
    (sum, r) => sum + (r.count ?? 0),
    0
  );

  return {
    stats: {
      users: users ?? 0,
      characters: characters ?? 0,
      conversations: conversations ?? 0,
      ads: ads ?? 0,
      pendingCharacters: pendingCharacters ?? 0,
      pendingSafetyReviews,
    },
    ops,
    recentUsers: recentUsers ?? [],
  };
}

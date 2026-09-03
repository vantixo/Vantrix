/**
 * GET /api/community/list
 *
 * Returns the community list: "General" and "Creator Hub" (the only two
 * communities — per-character/world-location/faction auto-generated
 * communities were removed 2026-08-24, see get-communities.ts's REMOVAL
 * note).
 *
 * Query params:
 *   type    — filter by CommunityType
 *   q       — search by name (case-insensitive)
 *   limit   — default 40, max 80
 *
 * ROOT-CAUSE FIX (2026-08-23): the fan-out/merge logic that used to live
 * inline in this file has moved to lib/community/get-communities.ts so it
 * can be called directly (no HTTP self-fetch) from
 * (app)/community/page.tsx. See lib/dating/get-world-home.ts's header
 * comment for the full root-cause writeup of why the self-fetch pattern
 * was producing the "responded 404" failures. This route is now a thin
 * auth-check + wrapper, kept for any client-side/external caller.
 *
 * Required tables: community_posts (for post counts).
 * See supabase/migrations/20241000_community.sql
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/get-authed-user";
import { logger } from "@/lib/logger";
import { getCommunityList } from "@/lib/community/get-communities";
import type { CommunityType } from "@/types/community";

export const dynamic = "force-dynamic";
export const revalidate = 60;

export async function GET(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const type = url.searchParams.get("type") as CommunityType | null;
    const q = url.searchParams.get("q") ?? undefined;
    const rawLimit = parseInt(url.searchParams.get("limit") ?? "40", 10);
    const limit = Math.min(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 40, 80);

    const communities = await getCommunityList({ type, q, limit });
    return NextResponse.json({ communities });
  } catch (err) {
    logger.error("community:list-error", { error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

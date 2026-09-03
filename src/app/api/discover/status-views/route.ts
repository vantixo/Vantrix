/**
 * GET/POST /api/discover/status-views
 *
 * Server-side counterpart to CharacterStatusRing's localStorage seen-state
 * (src/components/home/character-status-ring.tsx) — see migration
 * 20261032_character_status_views.sql for the table/RPC this backs. Ring
 * still reads/writes localStorage too so an anonymous visitor gets a
 * working (if device-local) seen/unseen ring; this is what lets a signed-in
 * user's state follow them to a second device or browser.
 *
 * GET  -> { viewedCharacterIds: string[] }  (empty array, not an error, for
 *          a signed-out visitor — same "anon just gets the empty/false
 *          state" posture as /api/characters/[id]/like's GET)
 * POST { characterId } -> { viewedAt: string }
 *          401 if signed out — there's no user row to attach a view to, and
 *          the client already has a localStorage fallback for that case.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/get-authed-user";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ viewedCharacterIds: [] });

    const { data, error } = await supabaseAdmin
      .from("character_status_views")
      .select("character_id")
      .eq("user_id", user.id);

    if (error) {
      logger.error("discover:status-views-get-error", { error: error.message });
      return NextResponse.json({ viewedCharacterIds: [] });
    }

    return NextResponse.json({
      viewedCharacterIds: (data ?? []).map((row) => row.character_id as string),
    });
  } catch (err) {
    logger.error("discover:status-views-get-error", { error: String(err) });
    return NextResponse.json({ viewedCharacterIds: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => null);
    const characterId = body?.characterId;
    if (typeof characterId !== "string" || characterId.length === 0) {
      return NextResponse.json({ error: "characterId is required" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin.rpc("mark_character_status_viewed", {
      p_character_id: characterId,
      p_user_id: user.id,
    });

    if (error) {
      logger.error("discover:status-views-post-error", {
        error: error.message,
        characterId,
      });
      return NextResponse.json({ error: "Could not save view" }, { status: 500 });
    }

    return NextResponse.json({ viewedAt: data });
  } catch (err) {
    logger.error("discover:status-views-post-error", { error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

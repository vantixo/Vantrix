/**
 * POST /api/characters/[id]/follow
 *
 * Atomically toggles the authenticated user's follow on a character via
 * the toggle_character_follow() Postgres function (see migration
 * 20260804_character_likes_and_follows.sql). Backed by a real join table
 * (character_follows), not a jsonb array, since follow relationships are
 * meant to be queried (e.g. "characters this user follows"), not just
 * counted.
 *
 * Returns: { following: boolean; followerCount: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/get-authed-user";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger, bg } from "@/lib/logger";
import { emitNotification } from "@/lib/notifications/emit";

export const dynamic = "force-dynamic";

function isFollowResult(value: unknown): value is { following: boolean; follower_count: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).following === "boolean" &&
    typeof (value as Record<string, unknown>).follower_count === "number"
  );
}

/**
 * GET /api/characters/[id]/follow
 *
 * Mirrors GET /api/characters/[id]/like: the profile page is static ISR
 * (24h, no auth), so per-user follow state can't be baked into the HTML.
 * Client fetches this after mount. Unauthenticated visitors get
 * `following: false`, not a 401.
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const { user } = await getAuthedUser();

    const { data: character, error: charError } = await supabaseAdmin
      .from("characters")
      .select("follower_count")
      .eq("id", params.id)
      .single();

    if (charError || !character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    let following = false;
    if (user) {
      const { data: followRow } = await supabaseAdmin
        .from("character_follows")
        .select("id")
        .eq("character_id", params.id)
        .eq("user_id", user.id)
        .maybeSingle();
      following = !!followRow;
    }

    return NextResponse.json({ following, followerCount: character.follower_count ?? 0 });
  } catch (err) {
    logger.error("characters:follow-status-error", { error: String(err), characterId: params.id });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data, error } = await supabaseAdmin.rpc("toggle_character_follow", {
      p_character_id: params.id,
      p_user_id: user.id,
    });

    if (error) {
      if (error.message.includes("Character not found")) {
        return NextResponse.json({ error: "Character not found" }, { status: 404 });
      }
      logger.error("characters:follow-rpc-error", { error: error.message, characterId: params.id });
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    if (!isFollowResult(data)) {
      logger.error("characters:follow-shape-error", { characterId: params.id, data: JSON.stringify(data) });
      return NextResponse.json({ error: "Unexpected response from follow toggle" }, { status: 500 });
    }

    if (data.following) {
      (async () => {
        const { data: character } = await supabaseAdmin
          .from("characters")
          .select("name,creator_id")
          .eq("id", params.id)
          .single();
        if (!character?.creator_id || character.creator_id === user.id) return;
        return emitNotification({
          userId: character.creator_id,
          type: "character_followed",
          title: "Someone followed you",
          body: `${character.name} got a new follower.`,
          ctaUrl: `/characters/${params.id}`,
          urgency: "low",
          metadata: { characterId: params.id },
        });
      })().catch(bg("emitNotification.characterFollowed"));
    }

    return NextResponse.json({ following: data.following, followerCount: data.follower_count });
  } catch (err) {
    logger.error("characters:follow-error", { error: String(err), characterId: params.id });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

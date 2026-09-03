/**
 * POST /api/characters/[id]/like
 *
 * Atomically toggles the authenticated user's like on a character via the
 * toggle_character_like() Postgres function (see migration
 * 20260804_character_likes_and_follows.sql) — same pattern as the
 * community post/reply like toggles, applied to characters.
 *
 * Returns: { liked: boolean; likeCount: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/get-authed-user";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger, bg } from "@/lib/logger";
import { emitNotification } from "@/lib/notifications/emit";

export const dynamic = "force-dynamic";

function isLikeResult(value: unknown): value is { liked: boolean; like_count: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).liked === "boolean" &&
    typeof (value as Record<string, unknown>).like_count === "number"
  );
}

/**
 * GET /api/characters/[id]/like
 *
 * Returns the *current* user's like state for this character, plus the live
 * count. The character profile page is statically rendered (ISR, 24h, no
 * auth) so it can never bake a per-user "liked" flag into the HTML — every
 * visitor would see whichever user's state happened to be cached. Instead
 * the client fetches this after mount to fill in the real state.
 *
 * Unauthenticated visitors get `liked: false` (not a 401) since anonymous
 * viewing of a character page is expected and shouldn't surface as an error.
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const { user } = await getAuthedUser();

    const { data: character, error: charError } = await supabaseAdmin
      .from("characters")
      .select("like_count, liked_by")
      .eq("id", params.id)
      .single();

    if (charError || !character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    const likedBy = Array.isArray(character.liked_by) ? (character.liked_by as string[]) : [];
    const liked = !!user && likedBy.includes(user.id);

    return NextResponse.json({ liked, likeCount: character.like_count ?? 0 });
  } catch (err) {
    logger.error("characters:like-status-error", { error: String(err), characterId: params.id });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data, error } = await supabaseAdmin.rpc("toggle_character_like", {
      p_character_id: params.id,
      p_user_id: user.id,
    });

    if (error) {
      if (error.message.includes("Character not found")) {
        return NextResponse.json({ error: "Character not found" }, { status: 404 });
      }
      logger.error("characters:like-rpc-error", { error: error.message, characterId: params.id });
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    if (!isLikeResult(data)) {
      logger.error("characters:like-shape-error", { characterId: params.id, data: JSON.stringify(data) });
      return NextResponse.json({ error: "Unexpected response from like toggle" }, { status: 500 });
    }

    // Notify the creator, not the liker — and only on a fresh like, not an unlike.
    if (data.liked) {
      (async () => {
        const { data: character } = await supabaseAdmin
          .from("characters")
          .select("name,creator_id")
          .eq("id", params.id)
          .single();
        if (!character?.creator_id || character.creator_id === user.id) return;
        return emitNotification({
          userId: character.creator_id,
          type: "character_liked",
          title: "Someone liked your character",
          body: `${character.name} got a new like.`,
          ctaUrl: `/characters/${params.id}`,
          urgency: "low",
          metadata: { characterId: params.id },
        });
      })().catch(bg("emitNotification.characterLiked"));
    }

    return NextResponse.json({ liked: data.liked, likeCount: data.like_count });
  } catch (err) {
    logger.error("characters:like-error", { error: String(err), characterId: params.id });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

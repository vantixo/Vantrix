/**
 * POST /api/community/replies/[id]/like
 *
 * Atomically toggles the authenticated user's like on a community reply.
 *
 * FIX: This previously did SELECT liked_by -> mutate array in application
 * code -> UPDATE liked_by/likes_count, which raced under concurrent
 * requests (two simultaneous toggles could read the same snapshot and
 * clobber each other's write, corrupting likes_count). Now delegates to
 * the toggle_community_reply_like() Postgres function (migration 20241200),
 * which performs the read-check-mutate-write under a single row lock,
 * making the toggle atomic regardless of concurrency.
 *
 * Returns: { liked: boolean; likes_count: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/get-authed-user";
import { supabaseAdmin }             from "@/lib/supabase/admin";
import { logger }                    from "@/lib/logger";

export const dynamic = "force-dynamic";

function isLikeResult(value: unknown): value is { liked: boolean; likes_count: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).liked === 'boolean' &&
    typeof (value as Record<string, unknown>).likes_count === 'number'
  );
}

export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data, error } = await supabaseAdmin.rpc('toggle_community_reply_like', {
      p_reply_id: params.id,
      p_user_id: user.id,
    });

    if (error) {
      if (error.message.includes('Reply not found')) {
        return NextResponse.json({ error: "Reply not found" }, { status: 404 });
      }
      logger.error("community:reply-like-rpc-error", { error: error.message, replyId: params.id });
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    if (!isLikeResult(data)) {
      logger.error("community:reply-like-shape-error", { replyId: params.id, data: JSON.stringify(data) });
      return NextResponse.json({ error: "Unexpected response from like toggle" }, { status: 500 });
    }

    return NextResponse.json({ liked: data.liked, likesCount: data.likes_count });
  } catch (err) {
    logger.error("community:reply-like-error", { error: String(err), replyId: params.id });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

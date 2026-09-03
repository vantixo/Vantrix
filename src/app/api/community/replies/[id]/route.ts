/**
 * DELETE /api/community/replies/[id]
 *
 * Lets an author delete their own reply. Mirrors posts/[id]/route.ts's
 * DELETE handler: RLS policy `community_replies_delete_own`
 * (20241000_community.sql) scopes this to `author_id = auth.uid()`, but
 * since this route uses supabaseAdmin (service role, bypasses RLS) like
 * every other community route, the ownership check below is what actually
 * enforces it on this path.
 *
 * Also decrements the parent post's reply_count via the
 * decrement_community_reply_count() RPC (20260821_community_moderation.sql)
 * — a plain read-then-write here would race the same way the like toggle
 * used to before it moved to an atomic RPC (see replies/[id]/like/route.ts).
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/get-authed-user";
import { supabaseAdmin }             from "@/lib/supabase/admin";
import { logger }                    from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("community_replies")
      .select("id, author_id, post_id")
      .eq("id", params.id)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json({ error: "Reply not found" }, { status: 404 });
    }
    if (existing.author_id !== user.id) {
      return NextResponse.json({ error: "You can only delete your own replies" }, { status: 403 });
    }

    const { error: deleteError } = await supabaseAdmin
      .from("community_replies")
      .delete()
      .eq("id", params.id);

    if (deleteError) {
      logger.error("community:reply-delete-error", { error: deleteError.message, replyId: params.id, userId: user.id });
      return NextResponse.json({ error: "Failed to delete reply" }, { status: 500 });
    }

    const { error: rpcError } = await supabaseAdmin.rpc("decrement_community_reply_count", {
      p_post_id: existing.post_id,
    });
    if (rpcError) {
      // Reply is already gone — don't fail the request over a stale counter,
      // just log it so it can be reconciled.
      logger.error("community:reply-count-decrement-error", { error: rpcError.message, postId: existing.post_id });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("community:reply-delete-error", { error: String(err), replyId: params.id });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

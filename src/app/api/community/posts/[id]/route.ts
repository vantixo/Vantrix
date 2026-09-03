/**
 * GET /api/community/posts/[id]
 *
 * Fetches a single community post by its ID.
 * Used by the DiscussionThread component for efficient single-post loading.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/get-authed-user";
import { supabaseAdmin }             from "@/lib/supabase/admin";
import { logger }                    from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data, error } = await supabaseAdmin
      .from("community_posts")
      .select(`
        id,
        community_slug,
        author_id,
        title,
        body,
        tag,
        likes_count,
        liked_by,
        reply_count,
        is_pinned,
        created_at,
        profiles:author_id ( username )
      `)
      .eq("id", params.id)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return NextResponse.json({ error: "Post not found" }, { status: 404 });
      }
      if (error.code === "42P01") {
        return NextResponse.json({ error: "Post not found" }, { status: 404 });
      }
      throw error;
    }

    const post = {
      id:            data.id,
      communitySlug: data.community_slug,
      authorId:      data.author_id,
      authorName:    (data.profiles as { username: string } | null)?.username ?? "Member",
      title:         data.title,
      body:          data.body,
      tag:           data.tag,
      likesCount:    data.likes_count,
      replyCount:    data.reply_count,
      userLiked:     Array.isArray(data.liked_by)
                       ? (data.liked_by as string[]).includes(user.id)
                       : false,
      isPinned:      data.is_pinned,
      createdAt:     data.created_at,
    };

    return NextResponse.json({ post });
  } catch (err) {
    logger.error("community:post-get-error", { error: String(err), postId: params.id });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/community/posts/[id]
 *
 * Lets an author delete their own post. The RLS policy
 * `community_posts_delete_own` (20241000_community.sql) already scopes
 * deletes to `author_id = auth.uid()`, but this route uses supabaseAdmin
 * (service role, bypasses RLS) like every other route in this file — so
 * the ownership check below is the only thing actually enforcing it on
 * this path. Replies cascade via `on delete cascade` on community_replies.
 */
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("community_posts")
      .select("id, author_id")
      .eq("id", params.id)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }
    if (existing.author_id !== user.id) {
      return NextResponse.json({ error: "You can only delete your own posts" }, { status: 403 });
    }

    const { error: deleteError } = await supabaseAdmin
      .from("community_posts")
      .delete()
      .eq("id", params.id);

    if (deleteError) {
      logger.error("community:post-delete-error", { error: deleteError.message, postId: params.id, userId: user.id });
      return NextResponse.json({ error: "Failed to delete post" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("community:post-delete-error", { error: String(err), postId: params.id });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

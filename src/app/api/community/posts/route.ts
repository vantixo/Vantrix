/**
 * GET  /api/community/posts  — paginated discussion feed for a community
 * POST /api/community/posts  — create a new post
 *
 * GET query params:
 *   slug   — community slug (required)
 *   sort   — "new" | "trending" | "top"  (default: "new")
 *   cursor — ISO string for cursor pagination (new sort only)
 *   limit  — default 20, max 40
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/get-authed-user";
import { supabaseAdmin }             from "@/lib/supabase/admin";
import { logger }                    from "@/lib/logger";
import { checkActionLimit } from "@/lib/rate-limit";
import { sanitizeField } from "@/lib/sanitize";
import { moderateCharacter } from "@/lib/moderation";

const VALID_TAGS = new Set(["discussion", "question", "theory", "tips", "fan-art", "lore", "milestone"]);

export const dynamic = "force-dynamic";

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const url    = new URL(req.url);
    const slug   = url.searchParams.get("slug");
    const sort   = (url.searchParams.get("sort") ?? "new") as "new" | "trending" | "top";
    const cursor = url.searchParams.get("cursor");
    const rawLimit = parseInt(url.searchParams.get("limit") ?? "20", 10);
    const limit    = Math.min(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 20, 40);

    if (!slug) return NextResponse.json({ error: "slug is required" }, { status: 400 });

    let query = supabaseAdmin
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
      .eq("community_slug", slug)
      .limit(limit + 1);

    if (sort === "trending") {
      query = query.gt("likes_count", 0).order("likes_count", { ascending: false });
    } else if (sort === "top") {
      query = query.order("likes_count", { ascending: false });
    } else {
      // new — cursor pagination by created_at desc, pinned first
      if (cursor) query = query.lt("created_at", cursor);
      query = query.order("is_pinned", { ascending: false }).order("created_at", { ascending: false });
    }

    const { data, error } = await query;

    if (error) {
      // Table might not exist yet
      if (error.code === "42P01") {
        return NextResponse.json({ posts: [], nextCursor: null });
      }
      throw error;
    }

    const rows       = (data ?? []).slice(0, limit);
    const hasMore    = (data ?? []).length > limit;
    const nextCursor = hasMore && rows.length > 0
      ? rows[rows.length - 1].created_at
      : null;

    const posts = rows.map((p) => ({
      id:            p.id,
      communitySlug: p.community_slug,
      authorId:      p.author_id,
      authorName:    (p.profiles as { username: string } | null)?.username ?? "Member",
      title:         p.title,
      body:          p.body,
      tag:           p.tag,
      likesCount:    p.likes_count,
      replyCount:    p.reply_count,
      userLiked:     Array.isArray(p.liked_by)
                       ? (p.liked_by as string[]).includes(user.id)
                       : false,
      isPinned:      p.is_pinned,
      createdAt:     p.created_at,
    }));

    return NextResponse.json({ posts, nextCursor });
  } catch (err) {
    logger.error("community:posts-get-error", { error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // HARDEN-FIX: post creation had no rate limit — an unmoderated-until-
    // reported feed with unlimited posting is a real spam surface.
    const actionLimit = await checkActionLimit(user.id, 'community_post');
    if (!actionLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many posts recently. Try again later.', retryAt: actionLimit.reset },
        { status: 429 },
      );
    }

    const body = await req.json() as {
      communitySlug: string;
      title:         string;
      body:          string;
      tag?:          string;
    };

    if (!body.communitySlug || !body.title?.trim() || !body.body?.trim()) {
      return NextResponse.json(
        { error: "communitySlug, title, and body are required" },
        { status: 422 },
      );
    }
    if (body.title.length > 200) {
      return NextResponse.json({ error: "Title must be 200 characters or less" }, { status: 422 });
    }
    if (body.body.length > 10_000) {
      return NextResponse.json({ error: "Body must be 10,000 characters or less" }, { status: 422 });
    }

    // SEC/CONTENT FIX (Phase B audit, 2026-08-06): title/body were inserted
    // completely raw — no sanitizeField (control-char/zero-width/homoglyph
    // stripping), and `tag` had no validation at all (any string accepted,
    // unbounded length). React's JSX text interpolation on the read side
    // means this was never exploitable as stored XSS, but it's still an
    // unmoderated, unsanitized public forum with zero content filtering —
    // inconsistent with every other free-text surface in the app
    // (characters, images, video prompts all go through sanitizeField/
    // moderateCharacter). Brought into parity here.
    const safeTitle = sanitizeField(body.title, 200);
    const safeBody  = sanitizeField(body.body, 10_000);
    if (!safeTitle || !safeBody) {
      return NextResponse.json({ error: "Title and body cannot be empty after sanitization" }, { status: 422 });
    }
    const safeTag = body.tag && VALID_TAGS.has(body.tag) ? body.tag : "discussion";

    const modResult = await moderateCharacter({ name: safeTitle, description: safeBody });
    if (!modResult.allowed) {
      return NextResponse.json({
        error: modResult.reason ?? "Post rejected by content policy",
        code: "CONTENT_POLICY_VIOLATION",
      }, { status: 422 });
    }

    const { data, error } = await supabaseAdmin
      .from("community_posts")
      .insert({
        community_slug: body.communitySlug,
        author_id:      user.id,
        title:          safeTitle,
        body:           safeBody,
        tag:            safeTag,
      })
      .select("id, created_at")
      .single();

    if (error) {
      logger.error("community:post-create-error", { error: error.message, userId: user.id });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ post: data }, { status: 201 });
  } catch (err) {
    logger.error("community:post-create-error", { error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

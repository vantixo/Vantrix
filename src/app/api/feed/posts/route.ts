/**
 * GET  /api/feed/posts  — Paginated character post feed
 * POST /api/feed/posts  — Create post (admin/service role only)
 *
 * Query params:
 *   cursor    — created_at ISO string for cursor pagination
 *   limit     — default 20, max 40
 *   filter    — "new" | "trending" | "all" (default "new")
 *   character — filter to single character ID
 *
 * Response: { posts: FeedPost[], nextCursor: string | null }
 *
 * Each FeedPost includes the character's name, image_url, gender,
 * and tags so the client doesn't need a second fetch.
 *
 * Trending sort: posts with > 10 likes, sorted by likes_count DESC.
 * New sort:      created_at DESC (default, most common).
 *
 * Per-user like status comes from the `post_likes` join table (post_id, user_id),
 * not a column on character_posts — looked up in a second query for the page
 * of posts being returned, then merged in as the boolean `user_liked` field.
 *
 * HARDENING FIX (audit 2026-06-21): this route is `force-dynamic` (it reads
 * the session) and the response is per-user (user_liked), so neither Next's
 * full-route cache nor ISR's `revalidate` export can ever apply here — a
 * previous `export const revalidate = 30` on this exact file was dead code
 * with a misleading "99% DB read reduction" comment; it had zero effect.
 * The actual fix: cache only the non-personalized part (the post list +
 * character join) in Redis, keyed on filter/cursor/limit — NOT on userId —
 * then always run the cheap per-user like lookup fresh. Cache failures fail
 * OPEN (fall through to Supabase) since this is a perf optimization, not a
 * safety gate.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { requireAdmin }               from '@/lib/auth/admin';
import { supabaseAdmin }              from '@/lib/supabase/admin';
import { requireSecret }              from '@/lib/security';
import { toErrorBody, errorLogFields }                from '@/lib/errors';
import { logger }                     from '@/lib/logger';
import { env }                        from '@/env';
import { getFeedPostsPage } from '@/lib/feed/get-posts';

export const dynamic = 'force-dynamic';

// ── GET ───────────────────────────────────────────────────────────────────────
// ROOT-CAUSE FIX (2026-08-23): the cache + query + like-merge logic that
// used to live inline here has moved to lib/feed/get-posts.ts so
// (app)/feed/page.tsx can call it directly (no HTTP self-fetch). This
// route is now a thin auth-check + query-param-parsing wrapper, kept for
// hooks/use-feed.ts's client-side infinite-scroll fetches, which run in
// the browser and need the real endpoint.

export async function GET(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url        = new URL(req.url);
    const cursor     = url.searchParams.get('cursor');
    const rawLimit   = parseInt(url.searchParams.get('limit') ?? '20', 10);
    const limit      = Math.min(Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 20), 40);
    const filter     = (url.searchParams.get('filter') ?? 'new') as 'new' | 'trending' | 'all';
    const charFilter = url.searchParams.get('character');

    const page = await getFeedPostsPage(user.id, { filter, character: charFilter, cursor, limit });

    return NextResponse.json(page, {
      headers: { 'Cache-Control': 'private, max-age=15, stale-while-revalidate=45' },
    });

  } catch (err) {
    logger.error('feed:posts-get-error', errorLogFields(err));
    return NextResponse.json(toErrorBody(err), { status: 500 });
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────
// Admin / creator endpoint — creates a character post.
// Accepts ADMIN_SECRET_TOKEN header (for crons/scripts) OR session admin.

export async function POST(req: NextRequest) {
  // Accept admin secret header first (cron / scripts)
  const isAdminSecret = requireSecret(req, env.ADMIN_SECRET_TOKEN);

  if (!isAdminSecret) {
    // Fall back to session-based admin check
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
      await requireAdmin(user.id);
    } catch {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  let body: {
    character_id: string;
    caption?:     string;
    image_url:    string;
    post_type?:   'photo' | 'text' | 'teaser';
    is_locked?:   boolean;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.character_id || !body.image_url) {
    return NextResponse.json(
      { error: 'character_id and image_url are required' },
      { status: 422 }
    );
  }

  const { data, error } = await supabaseAdmin
    .from('character_posts')
    .insert({
      character_id: body.character_id,
      caption:      body.caption   ?? null,
      image_url:    body.image_url,
      post_type:    body.post_type ?? 'photo',
      is_locked:    body.is_locked ?? false,
    })
    .select()
    .single();

  if (error) {
    logger.error('feed:post-create-error', { error: error.message });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  logger.info('feed:post-created', { postId: data.id, characterId: body.character_id });
  return NextResponse.json({ post: data }, { status: 201 });
}

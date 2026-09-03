/**
 * GET  /api/feed/posts/[id]/comments — Paginated comment thread for a post
 * POST /api/feed/posts/[id]/comments — Add a user comment to a post
 *
 * Comments are mixed-author: either a real user (author_user_id) or a
 * character (author_character_id), never both — see 20260823 migration.
 * Character-authored comments are produced by the character-social cron
 * (lib/ai/character-social-engine.ts); this route only ever inserts
 * user-authored rows — characters never post through this endpoint.
 *
 * Response rows are normalized to a single `author` shape regardless of
 * which side authored them, so the client doesn't need two render paths.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser }  from '@/lib/auth/get-authed-user';
import { supabaseAdmin }  from '@/lib/supabase/admin';
import { Ratelimit }      from '@upstash/ratelimit';
import { toErrorBody, errorLogFields }    from '@/lib/errors';
import { logger }         from '@/lib/logger';
import { redis }          from '@/lib/redis';
import { sanitizeField }  from '@/lib/sanitize';
import { moderateCharacter } from '@/lib/moderation';

export const dynamic = 'force-dynamic';

const MAX_COMMENT_LENGTH = 500;

const commentLimiter = new Ratelimit({
  redis,
  limiter:   Ratelimit.slidingWindow(10, '1 m'),
  prefix:    'vantrix:comment',
  analytics: false,
});

type NormalizedComment = {
  id:         string;
  content:    string;
  created_at: string;
  author: {
    type: 'user' | 'character';
    id:   string;
    name: string | null;
    image_url: string | null;
  };
};

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const postId = params.id;
    if (!postId) {
      return NextResponse.json({ error: 'Missing post id' }, { status: 400 });
    }

    const { searchParams } = new URL(req.url);
    const limit  = Math.min(Number(searchParams.get('limit') ?? 30) || 30, 60);
    const cursor = searchParams.get('cursor');

    let query = supabaseAdmin
      .from('character_post_comments')
      .select(
        'id,content,created_at,author_user_id,author_character_id,' +
        'profiles:author_user_id(username,avatar_url),' +
        'characters:author_character_id(name,image_url)',
      )
      .eq('post_id', postId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (cursor) query = query.lt('created_at', cursor);

    const { data, error } = await query;
    if (error) {
      logger.error('feed:comments-fetch-error', { postId, error: error.message });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    type CommentRow = {
      id: string;
      content: string;
      created_at: string;
      author_user_id: string | null;
      author_character_id: string | null;
      profiles: { username: string | null; avatar_url: string | null } | null;
      characters: { name: string; image_url: string | null } | null;
    };

    const comments: NormalizedComment[] = ((data ?? []) as unknown as CommentRow[]).map((row) => {
      const isCharacter = !!row.author_character_id;
      return {
        id:         row.id,
        content:    row.content,
        created_at: row.created_at,
        author: isCharacter
          ? { type: 'character' as const, id: row.author_character_id!, name: row.characters?.name ?? null, image_url: row.characters?.image_url ?? null }
          : { type: 'user' as const,      id: row.author_user_id!,      name: row.profiles?.username ?? null, image_url: row.profiles?.avatar_url ?? null },
      };
    });

    const nextCursor = comments.length === limit ? comments[comments.length - 1]!.created_at : null;

    return NextResponse.json({ comments, nextCursor });
  } catch (err) {
    logger.error('feed:comments-get-error', errorLogFields(err));
    return NextResponse.json(toErrorBody(err), { status: 500 });
  }
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const { user } = await getAuthedUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const postId = params.id;
    if (!postId) {
      return NextResponse.json({ error: 'Missing post id' }, { status: 400 });
    }

    const { success } = await commentLimiter.limit(user.id);
    if (!success) {
      return NextResponse.json({ error: 'Slow down — too many comments too fast' }, { status: 429 });
    }

    const body = await req.json().catch(() => null);
    const rawContent = typeof body?.content === 'string' ? body.content.trim() : '';

    if (!rawContent) {
      return NextResponse.json({ error: 'Comment cannot be empty' }, { status: 400 });
    }
    if (rawContent.length > MAX_COMMENT_LENGTH) {
      return NextResponse.json({ error: `Comment too long (max ${MAX_COMMENT_LENGTH} characters)` }, { status: 400 });
    }

    // SEC/CONTENT FIX (Phase B audit, 2026-08-06): same gap already found
    // and fixed in community/posts and community/posts/[id]/replies —
    // content was inserted raw, with no sanitization or moderation, on
    // this second, separate public-comment surface. Brought into parity.
    const content = sanitizeField(rawContent, MAX_COMMENT_LENGTH);
    if (!content) {
      return NextResponse.json({ error: 'Comment cannot be empty after sanitization' }, { status: 400 });
    }

    const modResult = await moderateCharacter({ name: 'comment', description: content });
    if (!modResult.allowed) {
      return NextResponse.json({
        error: modResult.reason ?? 'Comment rejected by content policy',
        code: 'CONTENT_POLICY_VIOLATION',
      }, { status: 422 });
    }

    const { data: post, error: postError } = await supabaseAdmin
      .from('character_posts')
      .select('id')
      .eq('id', postId)
      .maybeSingle();

    if (postError) {
      logger.error('feed:comments-post-lookup-error', { postId, error: postError.message });
      return NextResponse.json({ error: postError.message }, { status: 500 });
    }
    if (!post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('character_post_comments')
      .insert({ post_id: postId, author_user_id: user.id, content })
      .select('id,content,created_at')
      .single();

    if (insertError) {
      logger.error('feed:comments-insert-error', { postId, userId: user.id, error: insertError.message });
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ comment: inserted }, { status: 201 });
  } catch (err) {
    logger.error('feed:comments-post-error', errorLogFields(err));
    return NextResponse.json(toErrorBody(err), { status: 500 });
  }
}

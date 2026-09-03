/**
 * getFeedPostsPage — the actual paginated character-post-feed logic
 * (Redis-backed non-personalized cache, new/trending/all sort, per-user
 * like merge, locked-post image redaction).
 *
 * ROOT-CAUSE FIX (2026-08-23): same self-fetch issue as
 * lib/dating/get-world-home.ts and lib/community/get-communities.ts (see
 * the former's header comment for the full explanation) — this used to
 * live inline in app/api/feed/posts/route.ts, reachable from
 * (app)/feed/page.tsx only via lib/frontend/feed.ts's getFeedPosts(),
 * which round-trips through fetchInternal(). That file's own comment
 * argued the route's cache layer + sort branching + per-user merge was
 * "real request-shaping you don't want to reimplement," and therefore had
 * to go through HTTP — but that's an argument for extracting the logic
 * into an importable function (this file), not for leaving it inline and
 * self-fetching it. Moved here so the Server Component can call it
 * in-process; route.ts is now a thin wrapper around this for the client-
 * side infinite-scroll fetches in hooks/use-feed.ts, which still need the
 * real HTTP endpoint since they run in the browser.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { redis } from '@/lib/redis';
import type { FeedFilter, FeedPost, FeedPostsPage } from '@/types/feed';

// Non-personalized post-list cache. Short TTL: this smooths request bursts
// on a hot feed page, it is not meant to serve stale-for-minutes data. Key
// intentionally excludes userId — the cached payload never contains
// user_liked.
const FEED_CACHE_TTL_SECONDS = 20;

type RawFeedPost = Omit<FeedPost, 'user_liked'>;
type CachedPage = { posts: RawFeedPost[]; nextCursor: string | null };

function feedCacheKey(filter: string, charFilter: string | null, cursor: string | null, limit: number): string {
  return `feed:posts:${filter}:${charFilter ?? 'all'}:${cursor ?? 'first'}:${limit}`;
}

async function getCachedPage(key: string): Promise<CachedPage | null> {
  try {
    const cached = await redis.get<string>(key);
    return cached ? (JSON.parse(cached) as CachedPage) : null;
  } catch {
    return null; // fail OPEN — cache miss, fall through to Supabase
  }
}

async function setCachedPage(key: string, page: CachedPage): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(page), { ex: FEED_CACHE_TTL_SECONDS });
  } catch {
    // Non-fatal — caching is best-effort
  }
}

export async function getFeedPostsPage(
  userId: string,
  params: { filter?: FeedFilter; character?: string | null; cursor?: string | null; limit?: number } = {},
): Promise<FeedPostsPage> {
  const filter = params.filter ?? 'new';
  const charFilter = params.character ?? null;
  const cursor = params.cursor ?? null;
  const limit = Math.min(Math.max(1, params.limit && Number.isFinite(params.limit) ? params.limit : 20), 40);

  const cacheKey = feedCacheKey(filter, charFilter, cursor, limit);
  let posts: RawFeedPost[];
  let nextCursor: string | null;

  const cachedPage = await getCachedPage(cacheKey);
  if (cachedPage) {
    posts = cachedPage.posts;
    nextCursor = cachedPage.nextCursor;
  } else {
    // intro_video_url/gallery_*_urls added so FeedStoriesRail can open the
    // same CharacterStoryViewer Home's CharacterStatusRing already uses
    // (see components/home/character-story-viewer.tsx) instead of a
    // second bespoke viewer — no new table, no new route, same fields
    // /api/discover/featured already selects from `characters`.
    let query = supabaseAdmin
      .from('character_posts')
      .select(`
        id,
        caption,
        image_url,
        post_type,
        is_locked,
        likes_count,
        comments_count,
        created_at,
        character:characters!character_posts_character_id_fkey (
          id,
          name,
          image_url,
          gender,
          tags,
          is_live,
          intro_video_url,
          gallery_image_urls,
          gallery_video_urls
        )
      `)
      .limit(limit + 1); // +1 to detect next page

    if (charFilter) {
      query = query.eq('character_id', charFilter);
    }

    if (filter === 'trending') {
      query = query.gt('likes_count', 10).order('likes_count', { ascending: false });
    } else {
      if (cursor) query = query.lt('created_at', cursor);
      query = query.order('created_at', { ascending: false });
    }

    const { data, error } = await query;

    if (error) {
      logger.error('feed:posts-fetch-error', { error: error.message });
      return { posts: [], nextCursor: null };
    }

    const hasMore = (data ?? []).length > limit;
    posts = ((data ?? []) as unknown as RawFeedPost[]).slice(0, limit);
    nextCursor = hasMore && posts.length > 0 ? posts[posts.length - 1]!.created_at : null;

    await setCachedPage(cacheKey, { posts, nextCursor });
  }

  // Likes live in the post_likes join table, not a column on
  // character_posts — fetch this user's likes for the posts on this page.
  let likedPostIds = new Set<string>();
  if (posts.length > 0) {
    const { data: likes } = await supabaseAdmin
      .from('post_likes')
      .select('post_id')
      .eq('user_id', userId)
      .in('post_id', posts.map((p) => p.id));
    likedPostIds = new Set((likes ?? []).map((l) => l.post_id));
  }

  const annotated: FeedPost[] = posts.map((p) => ({
    ...p,
    user_liked: likedPostIds.has(p.id),
    // SEC/MONETIZATION FIX (Phase B audit, 2026-08-06) — see route.ts's
    // original comment: is_locked was cosmetic-only (CSS blur over the
    // real, full-resolution URL). Never send the real URL for a locked
    // post at all.
    image_url: p.is_locked ? null : p.image_url,
  }));

  return { posts: annotated, nextCursor };
}

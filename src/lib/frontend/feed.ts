import "server-only";
import { fetchInternal } from "./api";
import type { FeedPostsPage, FeedFilter } from "@/types/feed";

/**
 * FRONTEND-GAP FIX: /api/feed/posts (+ its like/comments sub-routes)
 * shipped with a full stack — Redis-backed non-personalized cache,
 * sort-dependent query building (new/trending/character-filtered),
 * per-user like-status merge, and locked-post image redaction — and zero
 * consuming page. Unreachable from any nav surface, same failure mode
 * nav-config.ts's own AMENDMENT comment already documents for Community.
 *
 * That request-shaping (cache layer + sort branching + per-user merge, all
 * inline in the route handler, not a separate importable function) is
 * exactly the "real request-shaping you don't want to reimplement" case
 * lib/frontend/api.ts's own doc comment describes, so this goes through
 * fetchInternal rather than querying Supabase directly — same call as
 * getCommunityPosts in community.ts, for the same reason.
 */
const EMPTY_PAGE: FeedPostsPage = { posts: [], nextCursor: null };

export async function getFeedPosts(params?: {
  filter?: FeedFilter;
  character?: string;
  cursor?: string;
  limit?: number;
}): Promise<FeedPostsPage> {
  const sp = new URLSearchParams();
  if (params?.filter) sp.set("filter", params.filter);
  if (params?.character) sp.set("character", params.character);
  if (params?.cursor) sp.set("cursor", params.cursor);
  if (params?.limit) sp.set("limit", String(params.limit));
  const qs = sp.toString();

  try {
    return await fetchInternal<FeedPostsPage>(`/api/feed/posts${qs ? `?${qs}` : ""}`);
  } catch {
    return EMPTY_PAGE;
  }
}

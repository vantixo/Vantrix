import "server-only";
import { fetchInternal } from "./api";
import { getCommunityList } from "@/lib/community/get-communities";
import { logger } from "@/lib/logger";
import type { Community, CommunityPost, CommunityReply, DiscussionSort } from "@/types/community";

/**
 * community/list, community/posts, and community/posts/[id]/replies all do
 * real request-shaping in the handler (character/world/faction fan-out and
 * merge, cursor pagination, sort-dependent query building, sanitization —
 * see those route files) rather than being thin wrappers over a single
 * table read, so per §10 this goes through fetchInternal rather than
 * reimplementing that logic here.
 *
 * DIAGNOSABILITY FIX: every catch below used to swallow the failure
 * completely and return the same empty shape a genuinely-empty result
 * would produce — "0 communities" and "fetchInternal threw" were
 * indistinguishable from the page. That's exactly what made the
 * self-fetch localhost/IPv6 bug (see lib/utils.ts's absoluteUrl()) so
 * hard to pin down: /community rendering "No communities match" looked
 * identical whether the DB genuinely had nothing or the internal request
 * never reached the route at all. Logging the real error here doesn't
 * change what the page shows (still degrades gracefully to empty), but
 * means the next time this class of bug resurfaces it's a line in the
 * server log instead of a guessing game.
 */

const EMPTY_COMMUNITIES: { communities: Community[] } = { communities: [] };
const EMPTY_POSTS: { posts: CommunityPost[]; nextCursor: string | null } = {
  posts: [],
  nextCursor: null,
};
const EMPTY_REPLIES: { replies: CommunityReply[] } = { replies: [] };

export async function getCommunities(params?: {
  type?: string;
  q?: string;
  limit?: number;
}): Promise<Community[]> {
  const sp = new URLSearchParams();
  if (params?.type) sp.set("type", params.type);
  if (params?.q) sp.set("q", params.q);
  if (params?.limit) sp.set("limit", String(params.limit));
  const qs = sp.toString();

  try {
    const data = await fetchInternal<{ communities: Community[] }>(
      `/api/community/list${qs ? `?${qs}` : ""}`
    );
    return data.communities;
  } catch (err) {
    logger.error("frontend:community-list-fetch-failed", { error: String(err) });
    return EMPTY_COMMUNITIES.communities;
  }
}

/**
 * There's no single-community endpoint — /api/community/list already
 * returns the full set (just two static communities — see
 * get-communities.ts), so finding one by slug means fetching the list and
 * filtering rather than a second round trip that would just re-derive the
 * same data.
 *
 * ROOT-CAUSE FIX (2026-08-25): this was the one remaining caller of the
 * old getCommunities() self-fetch (fetchInternal -> /api/community/list),
 * missed in the 2026-08-23 sweep that moved community/page.tsx and
 * dating/page.tsx off the same pattern — see lib/dating/get-world-home.ts's
 * header comment for the full root-cause writeup (dev-server single-worker
 * contention between the outer page request and the inner self-fetch,
 * surfacing as a 404). community/[slug]/page.tsx calls this on every visit
 * to an individual community (General, Creator Hub), so every click into
 * either one hit that same 404 even though the community list itself
 * (which had already been migrated) loaded fine. Same fix as before: call
 * getCommunityList() directly, in-process, no HTTP hop.
 *
 * NOTE: this was getCommunities()'s only remaining real caller —
 * CommunityBrowser filters client-side against a server-fetched `initial`
 * prop and never calls it (verified via grep, not assumed). getCommunities()
 * is left in place, unmodified and still exported, rather than removed as
 * part of this fix — it's a public export from a lib/frontend/ file, and
 * deleting an unused-today export is a separate call from fixing the bug
 * this function's use of it was causing.
 */
export async function getCommunityBySlug(slug: string): Promise<Community | null> {
  try {
    const all = await getCommunityList({ limit: 80 });
    return all.find((c) => c.slug === slug) ?? null;
  } catch (err) {
    logger.error("frontend:community-by-slug-fetch-failed", { error: String(err), slug });
    return null;
  }
}

export async function getCommunityPosts(
  slug: string,
  params?: { sort?: DiscussionSort; cursor?: string; limit?: number }
): Promise<{ posts: CommunityPost[]; nextCursor: string | null }> {
  const sp = new URLSearchParams({ slug });
  if (params?.sort) sp.set("sort", params.sort);
  if (params?.cursor) sp.set("cursor", params.cursor);
  if (params?.limit) sp.set("limit", String(params.limit));

  try {
    return await fetchInternal<{ posts: CommunityPost[]; nextCursor: string | null }>(
      `/api/community/posts?${sp.toString()}`
    );
  } catch (err) {
    logger.error("frontend:community-posts-fetch-failed", { error: String(err), slug });
    return EMPTY_POSTS;
  }
}

export async function getCommunityPost(id: string): Promise<CommunityPost | null> {
  try {
    const data = await fetchInternal<{ post: CommunityPost }>(`/api/community/posts/${id}`);
    return data.post;
  } catch (err) {
    logger.error("frontend:community-post-fetch-failed", { error: String(err), id });
    return null;
  }
}

export async function getCommunityReplies(id: string): Promise<CommunityReply[]> {
  try {
    const data = await fetchInternal<{ replies: CommunityReply[] }>(
      `/api/community/posts/${id}/replies`
    );
    return data.replies;
  } catch (err) {
    logger.error("frontend:community-replies-fetch-failed", { error: String(err), id });
    return EMPTY_REPLIES.replies;
  }
}

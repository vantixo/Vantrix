import { getFeedPostsPage } from "@/lib/feed/get-posts";
import { getAuthedUser } from "@/lib/auth/get-authed-user";
import { getInlineAds } from "@/lib/frontend/ads";
import { logger } from "@/lib/logger";
import { FeedGrid } from "@/components/feed/feed-grid";

export const dynamic = "force-dynamic";

/**
 * Frontend gap fix — /api/feed/posts (+ /like, /comments) shipped with a
 * full stack (Redis-backed cache, likes, comments, locked/premium posts)
 * and zero consuming page. Entry point: character post feed with
 * new/trending/all filtering, per-post like + inline comments.
 *
 * INSTAGRAM-STYLE PASS: single, centered column (Instagram's own web feed
 * sits at ~470-630px, not a 2-up grid) instead of the old max-w-4xl
 * sm:grid-cols-2 layout. The old icon+h1 header is dropped in favor of the
 * stories rail as the opening move — the shell's persistent TopBar already
 * carries the Vantrix wordmark, so repeating "Feed" as a second page-level
 * heading was chrome the page didn't need. `h1` stays for a11y (screen
 * readers still need a landmark) but is visually silent.
 *
 * ROOT-CAUSE FIX (2026-08-23): previously called getFeedPosts() from
 * lib/frontend/feed.ts, which round-tripped through an HTTP self-fetch
 * back to this same Next.js process — the same failure mode already fixed
 * on the Dating World and Community pages (see
 * lib/dating/get-world-home.ts's header comment for the full writeup).
 * This page now calls the shared feed logic directly, in-process.
 * hooks/use-feed.ts's client-side infinite scroll still goes through the
 * real /api/feed/posts endpoint, since that runs in the browser.
 */
export default async function FeedPage() {
  // Fired before the auth+posts work below rather than awaited inline —
  // getInlineAds() doesn't depend on the authed user, so there's no reason
  // to serialize it behind that lookup (same parallelization rationale as
  // the home page's getDiscoverHome/getHeroAds/getAuthedUser trio).
  const adsPromise = getInlineAds();

  let page: Awaited<ReturnType<typeof getFeedPostsPage>> = { posts: [], nextCursor: null };
  try {
    const { user } = await getAuthedUser();
    if (user) {
      page = await getFeedPostsPage(user.id, { filter: "new" });
    }
  } catch (err) {
    logger.error("feed-page:fetch-failed", { error: String(err) });
  }
  const ads = await adsPromise;

  return (
    <div className="mx-auto max-w-[520px] py-4">
      <h1 className="sr-only">Feed</h1>
      <FeedGrid initialPosts={page.posts} initialNextCursor={page.nextCursor} ads={ads} />
    </div>
  );
}

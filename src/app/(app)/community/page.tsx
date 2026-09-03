import { MessagesSquare } from "lucide-react";
import { getCommunityList } from "@/lib/community/get-communities";
import { logger } from "@/lib/logger";
import { CommunityBrowser } from "@/components/community/community-browser";

export const dynamic = "force-dynamic";

/**
 * Frontend gap fix — /api/community/list, /posts, /replies, and
 * feed/posts existed with zero consuming pages. This is the entry point:
 * every community (static General/Creator Hub plus one per character,
 * world location, and faction) with search + type filtering, linking
 * into /community/[slug] for the discussion feed itself.
 */
export default async function CommunityIndexPage() {
  // ROOT-CAUSE FIX (2026-08-23): previously called getCommunities(), which
  // round-tripped through an HTTP self-fetch back to this same Next.js
  // process — the source of the repeated "responded 404" failures (same
  // root cause as the dating world page; see
  // lib/dating/get-world-home.ts's header comment). Calling the shared
  // fan-out/merge logic directly avoids that network hop entirely.
  let communities: Awaited<ReturnType<typeof getCommunityList>> = [];
  try {
    communities = await getCommunityList({ limit: 80 });
  } catch (err) {
    logger.error("community-page:fetch-failed", { error: String(err) });
  }

  return (
    <div className="mx-auto max-w-4xl px-4 md:px-8 py-6">
      <div className="flex items-center gap-2 mb-4">
        <MessagesSquare className="h-5 w-5 text-gold-500" strokeWidth={1.75} />
        <h1 className="font-display text-2xl text-text-primary">Community</h1>
      </div>

      <CommunityBrowser initial={communities} />
    </div>
  );
}

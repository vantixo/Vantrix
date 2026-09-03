import "server-only";
import { fetchInternal } from "./api";

/**
 * Shapes mirror GET /api/user/home-context's response exactly (see that
 * route's ConvRow/InitiativeRow mapping). Real request-shaping already
 * lives in that route (auth gating, urgency sort, graceful degrade), so
 * per FRONTEND_DIRECTIVE §10 this goes through fetchInternal rather
 * than re-querying Supabase directly here.
 *
 * FAKE-DATA FIX: home-side-rail.tsx's "Someone is thinking about you"
 * previously showed spotlight[0] — an arbitrary character from the
 * discover feed, unrelated to whether that character had actually
 * reached out — and continue-your-stories.tsx showed a hashed fake
 * "progress %" on top of the same arbitrary characters instead of real
 * conversations. This route already returns exactly the right data for
 * both (real character_initiatives rows, real conversations rows) and
 * had zero callers anywhere in the tree. This is that first caller.
 */
export interface HomeContextChat {
  conversationId: string;
  lastMessageAt: string | null;
  character: {
    id?: string;
    name?: string;
    image_url?: string | null;
    is_live?: boolean;
    is_premium?: boolean;
    min_tier?: string;
    opening_line?: string | null;
    archetype?: string | null;
  };
}

export interface HomeContextInitiative {
  id: string;
  type: string;
  message: string;
  urgency: string;
  createdAt: string;
  character: { id: string; name: string; image_url: string };
}

export interface HomeContextProfile {
  tier: string;
  daily_messages_used: number;
  daily_messages_limit: number;
  tokens: number;
}

export interface HomeContextData {
  recentChats: HomeContextChat[];
  pendingInitiatives: HomeContextInitiative[];
  profile: HomeContextProfile | null;
}

const EMPTY_CONTEXT: HomeContextData = {
  recentChats: [],
  pendingInitiatives: [],
  profile: null,
};

/**
 * Fails soft to the empty-but-valid shape, same contract as
 * getDiscoverHome — a network-level failure on this hop renders Home's
 * normal "no recent activity" state rather than crashing the page.
 */
export async function getHomeContext(): Promise<HomeContextData> {
  try {
    return await fetchInternal<HomeContextData>("/api/user/home-context");
  } catch {
    return EMPTY_CONTEXT;
  }
}

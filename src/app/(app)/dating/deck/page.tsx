import { SwipeDeck } from "@/components/dating/swipe-deck";

/**
 * §12 phase 4: deck/swipe/matches/gifts. The deck itself is fully
 * client-driven (drag gestures, optimistic card removal, live swipe-limit
 * countdown) so this page is just the shell; SwipeDeck owns its own data
 * via useDatingDeck() rather than this being a server-fetched initial
 * state, since GET /api/dating/deck already needs to be callable again on
 * every reload/refresh anyway.
 *
 * Moved here from the /dating root — the root is now "Your World"
 * (GET /api/dating/world), the actual Dating-tab landing surface per the
 * frontend directive; discovery/swiping is one action launched from there
 * rather than the only thing the tab does.
 */
export default function DatingDeckPage() {
  return <SwipeDeck />;
}

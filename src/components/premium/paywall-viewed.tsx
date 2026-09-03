"use client";

import { useEffect } from "react";
import { capture } from "@/lib/analytics/client";

/**
 * Fires `paywall_viewed` (see lib/analytics/events.ts) once per mount of
 * /premium — the funnel-entry event upstream of `checkout_started`. Kept
 * as its own tiny client component, same pattern as AnalyticsIdentify in
 * lib/analytics/client.tsx, so the parent page (PremiumPage) can stay a
 * Server Component rather than becoming "use client" just to call
 * capture() once.
 *
 * Mount this from any other paywall surface as it's built (in-chat
 * paywall, video gate, etc.) with that surface's own `surface` value —
 * this file isn't premium-page-specific despite the current single call
 * site.
 */
export function PaywallViewed({
  surface,
  currentTier,
}: {
  surface: string;
  currentTier: string;
}) {
  useEffect(() => {
    capture("paywall_viewed", { surface, current_tier: currentTier });
    // Deliberately fire-once-per-mount: re-running on every currentTier/
    // surface identity change (which shouldn't happen for a static page
    // prop anyway) would double-count a single page view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

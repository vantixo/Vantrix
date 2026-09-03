"use client";

import { Heart, Flame, Crown } from "lucide-react";
import { MediaCard } from "@/components/ui/media-card";
import { Badge } from "@/components/ui/badge";
import { cn, resolveImageSrc } from "@/lib/utils";
import type { DiscoverCharacter } from "@/lib/frontend/discover";

/**
 * §3.3 Featured Companions card spec: image, "NEW" badge (gold, not
 * pink — §9.4 resolved gold-monochrome in badge.tsx), name, one-line
 * trait tags, like count (gold heart icon + number).
 *
 * `className` defaults to the fixed scroll-row width (unchanged
 * behavior for every existing caller) but is overridable — the
 * Characters browse page (§12 Phase 3) reuses this same card inside a
 * CSS grid, where a fixed width would leave ragged gaps instead of
 * filling its cell.
 *
 * CLICK-TRACKING: this is the single card component reused across every
 * discovery surface (Home's Explore/Featured rows, /characters browse,
 * dating suggestions, anon hero) — so it's the one place to ping
 * POST /api/characters/click, rather than wiring each caller separately.
 * Marked "use client" so the tap handler works even for callers that
 * render this from a Server Component (featured-companions.tsx,
 * home-side-rail.tsx, anon-hero.tsx, post-chat-suggestions.tsx) — a
 * Server Component can't hand a function prop to a Client Component
 * (MediaCard → next/link), but it CAN render a Client Component and let
 * that component build its own handler internally, which is what
 * happens here. See lib/recommendations/trending.ts for what the count
 * feeds into.
 */
export function CompanionCard({
  character,
  className,
  hot = false,
}: {
  character: DiscoverCharacter;
  className?: string;
  /** Trending-tab flame badge — takes priority over the New badge. */
  hot?: boolean;
}) {
  // DEFENSIVE (2026-08-25): tags is expected to always be an array (see
  // DiscoverCharacter), but this is the one component every discovery
  // surface on Home shares — Featured Companions, Explore Characters,
  // the side rail, dating suggestions — so a single record with a null/
  // missing tags column (a bad migration default, a partially-seeded
  // row) would take out every one of those sections' renders at once
  // with a bare TypeError, not just fail to show that one card. `?? []`
  // costs nothing when tags is already a real array.
  const traitLine = (character.tags ?? []).slice(0, 3).join(" · ");
  const badge = hot ? (
    <Badge className="gap-1">
      <Flame className="h-3 w-3" strokeWidth={2.5} />
      Hot
    </Badge>
  ) : character.is_new ? (
    <Badge>New</Badge>
  ) : undefined;

  // PREMIUM-LOCK VISIBILITY: character.is_premium (min_tier-gated content —
  // see lib/access/character-gate.ts's checkCharacterTierAccess, the
  // server-side enforcement this badge is only a preview of) previously had
  // no visual signal at all on this card — a locked character looked
  // identical to a free one until the user tapped in and hit the paywall.
  // Deliberately shown to every viewer, not just free-tier ones: this
  // component is called from four places (Home, browse, dating suggestions,
  // post-chat) that don't currently thread a viewer tier through, and
  // showing it unconditionally costs a premium viewer nothing (they'll
  // never hit the gate) while consistently priming intent for everyone
  // else *before* the tap — same principle as marking locked content in
  // any storefront regardless of who's logged in.
  const cornerBadge = character.is_premium ? (
    <Badge variant="outline" className="gap-1">
      <Crown className="h-3 w-3" strokeWidth={2} />
      Premium
    </Badge>
  ) : undefined;

  return (
    <MediaCard
      href={`/characters/${character.id}`}
      image={resolveImageSrc(character.image_url)}
      alt={character.name}
      badge={badge}
      cornerBadge={cornerBadge}
      onClick={() => pingCharacterClick(character.id)}
      className={cn("shrink-0 w-[168px] sm:w-[200px]", className)}
    >
      <div className="text-text-primary font-semibold text-[15px] leading-tight truncate">
        {character.name}
        {character.age ? (
          <span className="text-text-secondary font-normal">, {character.age}</span>
        ) : null}
      </div>
      {traitLine && (
        <div className="text-text-secondary text-xs mt-0.5 truncate">
          {traitLine}
        </div>
      )}
      {character.reason && (
        <div className="text-gold-400/90 text-xs mt-1 leading-snug line-clamp-2">
          {character.reason}
        </div>
      )}
      <div className="flex items-center justify-between mt-1.5">
        <div className="flex items-center gap-1 text-gold-400 text-xs font-semibold tabular-nums">
          <Heart className="h-3.5 w-3.5 fill-gold-400" strokeWidth={0} />
          {character.like_count.toLocaleString()}
        </div>
        {character.is_premium && (
          <span className="text-gold-400 text-[11px] font-bold tracking-wide uppercase">
            Unlock
          </span>
        )}
      </div>
    </MediaCard>
  );
}

/** Fire-and-forget — never blocks or delays the navigation it's attached to. */
function pingCharacterClick(id: string) {
  fetch("/api/characters/click", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
    keepalive: true,
  }).catch(() => {});
}

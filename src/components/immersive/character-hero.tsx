import { Badge } from "@/components/ui/badge";
import { resolveImageSrc } from "@/lib/utils";
import type { CharacterDetail } from "@/lib/frontend/characters";
import { CinematicBackground } from "./cinematic-background";
import { CharacterPresence } from "./character-presence";
import { CharacterPortraitViewer } from "./character-portrait-viewer";
import { CharacterReactionBurst } from "./character-reaction-burst";
import { PremiumBadge } from "./premium-badge";
import { MotionWrapper } from "./motion-wrapper";
import { cinematicReveal } from "./motion";

/**
 * Phase 1 Immersive UI Upgrade §11-13: the character detail page's
 * "reference experience" hero. Reuses everything already on
 * CharacterDetail (image_url/tags/archetype/is_new/is_premium) — no new
 * API route, no schema change (spec §19: "do not duplicate existing
 * backend functionality").
 *
 * Layered, cheapest-first (spec §3): CinematicBackground (pure CSS,
 * bleeds behind the portrait into the page's own bg-base) → the existing
 * optimized character image → the existing gradient-scrim + badge
 * pattern from landing-page.tsx's CharacterPortrait, reused rather than
 * reinvented → CharacterPresence (server-rendered, zero-cost) replacing
 * any "Online now" language for this page.
 *
 * Wrapped in MotionWrapper's cinematicReveal — a single 700ms entrance,
 * within spec §18's 500-900ms cinematic ceiling, and automatically
 * skipped for prefers-reduced-motion users.
 *
 * LIVING-PORTRAIT (spec §13 "Character Reactions"): the portrait runs a
 * near-imperceptible `animate-breathe` loop (scale 1 → 1.015 → 1 over
 * 7s, see tailwind.config.ts) — but only in direct response to a tap/
 * click or keyboard focus (see living-portrait.tsx), not continuously on
 * every page view. Transform-only, so it's compositor-cheap while it
 * runs, and it's a plain CSS `animation` so the global
 * prefers-reduced-motion kill switch in globals.css already disables it
 * for anyone who needs that. This is NOT applied to CompanionCard/
 * MediaCard grid images: those already run a hover-triggered
 * `group-hover/card:scale-[1.03]` *transition* (see media-card.tsx) —
 * stacking an `animation` on the same `transform` property would fight
 * that transition rather than compose with it, and spec §8 scopes cards
 * to "subtle hover/touch animation... no excessive animation" in the
 * first place. Singular hero surfaces only (this page, the landing-page
 * featured portrait).
 *
 * CHARACTER-REACTIONS (spec §13, cont'd): beyond the ambient breathe
 * loop, the portrait also reacts to specific user actions — a like
 * triggers a heart-burst + glow pulse (see character-reaction-burst.tsx).
 * Requires a CharacterReactionProvider ancestor (see the [id]/page.tsx
 * route, which wraps this component and CharacterEngagement together);
 * without one, CharacterReactionBurst just renders nothing rather than
 * erroring, so this component stays safe to reuse on its own.
 *
 * OVERFLOW-FIX (revisit pass): CinematicBackground is deliberately given
 * a negative inset (`-inset-8`) so its glow bleeds past the portrait's
 * own edges into the page background — that's the atmospheric effect.
 * CinematicBackground's own `overflow-hidden` only clips content
 * *inside* that box; it does nothing to stop the box itself, now larger
 * than its positioned parent, from being counted in an ancestor's
 * scrollable area. No ancestor up to <body> sets overflow-x anywhere in
 * this codebase (checked globals.css/layout.tsx), so on a viewport-width
 * mobile screen that 32px bleed could add a few pixels of unwanted
 * horizontal scroll. `overflow-x-hidden` on this component's own
 * relative wrapper contains it at the source — `-x-` only, not
 * `overflow-hidden`, so the vertical bleed above/below the portrait
 * (the actual visible part of the effect) is untouched.
 */
export function CharacterHero({
  character,
}: {
  character: Pick<
    CharacterDetail,
    | "id" | "name" | "age" | "image_url" | "tags" | "archetype" | "is_new" | "is_premium" | "model_url"
    | "hair_color" | "eye_color" | "skin_tone" | "body_type"
  >;
}) {
  return (
    <MotionWrapper variants={cinematicReveal} className="relative overflow-x-hidden">
      <CinematicBackground intensity={character.is_premium ? "premium" : "default"} className="-inset-8" />
      <div className="relative aspect-[4/5] w-full max-w-sm mx-auto rounded-lg overflow-hidden border border-border-hairline shadow-card">
        <CharacterPortraitViewer
          modelUrl={character.model_url}
          imageSrc={resolveImageSrc(character.image_url)}
          alt={character.name}
          sizes="(max-width: 640px) 100vw, 384px"
          priority
          appearance={{
            hair_color: character.hair_color,
            eye_color: character.eye_color,
            skin_tone: character.skin_tone,
            body_type: character.body_type,
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/5 to-transparent" />
        {/* CHARACTER-REACTIONS: reads CharacterReactionProvider's shared
            state — see character-reaction-context.tsx. Renders nothing
            until something (e.g. CharacterEngagement's like button)
            triggers a reaction. */}
        <CharacterReactionBurst />

        <div className="absolute top-3 left-3 flex gap-2">
          {character.is_new && <Badge>New</Badge>}
          {/* DEDUP-FIX (revisit pass): was inline Crown+Badge markup
              duplicating premium-badge.tsx's whole reason for existing —
              using the primitive here instead of next to it. */}
          {character.is_premium && <PremiumBadge />}
        </div>

        <div className="absolute bottom-3 left-3 right-3">
          <CharacterPresence characterId={character.id} tags={character.tags} showFlavor />
        </div>
      </div>
    </MotionWrapper>
  );
}

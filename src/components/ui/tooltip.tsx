"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

/**
 * Minimal, restrained tooltip — no arrow, no gold, just the same
 * bg-base / border-hairline / shadow-card surface every other floating
 * panel in this app uses (account-menu.tsx's dropdown content is the
 * closest sibling). Reserved for icon-only UI where a label genuinely
 * isn't visible any other way (the collapsed sidebar rail) — not a
 * general-purpose help-text component, per §1's "keep gold/decoration
 * restrained" rule extended to chrome in general.
 *
 * Each instance wraps its own Provider (short delayDuration) instead of
 * requiring a single app-root Provider — keeps this fully self-
 * contained with no changes to app/layout.tsx, at the cost of the
 * hover-delay not being shared across separate Tooltip instances.
 * Acceptable for the sidebar's one-icon-at-a-time hover pattern; revisit
 * with a root-level Provider if a second consumer needs shared timing.
 *
 * `disabled` short-circuits to a plain passthrough (no Radix mount at
 * all) — used by the sidebar so an *expanded* rail, which already shows
 * the label as text, never pays for tooltip machinery it doesn't need.
 */
export function Tooltip({
  children,
  content,
  side = "right",
  disabled = false,
}: {
  children: React.ReactNode;
  content: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  disabled?: boolean;
}) {
  if (disabled) return <>{children}</>;

  return (
    <TooltipPrimitive.Provider delayDuration={150} skipDelayDuration={300}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={10}
            className={cn(
              "z-50 select-none rounded-xs border border-border-hairline bg-base px-2.5 py-1.5 text-xs font-medium text-text-primary shadow-card",
              "animate-fade-in",
              "data-[state=closed]:animate-none"
            )}
          >
            {content}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

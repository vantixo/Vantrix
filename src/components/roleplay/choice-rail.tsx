"use client";

import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RoleplayChoice } from "@/types/roleplay";

/**
 * CHAT-PARITY PASS: previously a flat `rounded-md` button with a static
 * border — no shadow, no hover motion, nothing that read as "premium"
 * the way message-bubble.tsx's shadow-card + hairline treatment does.
 * Now matches the card vocabulary used everywhere else (shadow-card,
 * backdrop-blur-sm on the translucent scene backdrop, rounded-lg) plus
 * a small directional cue (ChevronRight, nudges right on hover) so a
 * choice reads as an affordance, not just colored text in a box.
 */
export function ChoiceRail({
  choices,
  onPick,
  disabled,
}: {
  choices: RoleplayChoice[];
  onPick: (choice: RoleplayChoice) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      {choices.map((choice) => (
        <button
          key={choice.id}
          disabled={disabled}
          onClick={() => onPick(choice)}
          className={cn(
            "group flex items-center justify-between gap-3 rounded-lg border border-gold-500/30 bg-base/60 px-4 py-3 text-left text-[15px] text-text-primary shadow-card backdrop-blur-sm transition-all duration-150 ease-premium",
            "hover:border-gold-500/70 hover:bg-gold-500/[0.06] active:scale-[0.99]",
            "disabled:pointer-events-none disabled:opacity-40",
          )}
        >
          <span>{choice.label}</span>
          <ChevronRight className="h-4 w-4 shrink-0 text-gold-500/50 transition-transform duration-150 ease-premium group-hover:translate-x-0.5 group-hover:text-gold-400" />
        </button>
      ))}
      <p className="px-1 text-[11px] text-text-tertiary">
        Or write your own action below instead.
      </p>
    </div>
  );
}

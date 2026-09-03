"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { STAGES, type CharacterDraft, type StageId } from "./types";
import { stageComplete } from "./completeness";

export function StageRail({
  draft,
  activeStage,
  onSelect,
  furthestIndex,
}: {
  draft: CharacterDraft;
  activeStage: StageId;
  onSelect: (stage: StageId) => void;
  /** Index of the furthest stage the creator has reached — stages beyond this are disabled, not just unchecked. */
  furthestIndex: number;
}) {
  return (
    <nav className="flex md:flex-col gap-1 overflow-x-auto no-scrollbar md:overflow-visible">
      {STAGES.map((stage, i) => {
        const done = stageComplete(draft, stage.id);
        const active = stage.id === activeStage;
        const reachable = i <= furthestIndex;
        return (
          <button
            key={stage.id}
            type="button"
            disabled={!reachable}
            onClick={() => reachable && onSelect(stage.id)}
            className={cn(
              "shrink-0 flex items-center gap-2.5 rounded-sm px-3 py-2.5 text-left text-sm font-medium transition-colors ease-premium duration-150",
              "md:w-full",
              active
                ? "bg-gold-500/10 text-gold-400"
                : reachable
                  ? "text-text-secondary hover:text-text-primary hover:bg-white/[0.04]"
                  : "text-text-tertiary/50 cursor-not-allowed",
            )}
          >
            <span
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold tabular-nums",
                done
                  ? "bg-gold-500 border-gold-500 text-[#160F02]"
                  : active
                    ? "border-gold-500 text-gold-400"
                    : "border-border-hairline text-text-tertiary",
              )}
            >
              {done ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            <span className="whitespace-nowrap md:whitespace-normal">{stage.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

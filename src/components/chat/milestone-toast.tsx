"use client";

import { Sparkles, X } from "lucide-react";
import type { MilestoneNotification } from "@/hooks/use-milestone-notifications";

/**
 * Same gold/Sparkles treatment date-picker.tsx already uses for its inline
 * "milestone unlocked" message (rounded-sm, border-gold-500/30,
 * bg-gold-500/5, text-gold-400) — kept identical here so a milestone reads
 * the same whether it's surfaced inline after an action or pushed live
 * during a chat.
 */
export function MilestoneToastStack({
  milestones,
  onDismiss,
}: {
  milestones: MilestoneNotification[];
  onDismiss: (id: string) => void;
}) {
  if (milestones.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col gap-2 p-3">
      {milestones.map((m) => (
        <div
          key={m.id}
          className="pointer-events-auto flex items-start gap-2 rounded-sm border border-gold-500/30 bg-base/95 px-3 py-2 text-sm text-gold-400 shadow-gold-glow backdrop-blur animate-slide-in-top"
        >
          <Sparkles className="h-4 w-4 shrink-0 mt-0.5" />
          <span className="flex-1 text-text-primary">
            <span className="text-gold-400">{m.characterName}</span> — {m.message}
          </span>
          <button
            onClick={() => onDismiss(m.id)}
            aria-label="Dismiss"
            className="shrink-0 text-text-tertiary hover:text-text-primary"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

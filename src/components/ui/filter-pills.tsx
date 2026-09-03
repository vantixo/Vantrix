"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface FilterPillOption {
  value: string;
  label: string;
  /** Optional leading icon (e.g. Search/Describe mode toggles). */
  icon?: ReactNode;
}

/**
 * Single-select pill row (§4). Active = gold-filled, per §6 the color
 * swap is instant / near-instant — no elaborate animation.
 *
 * This is the one place `bg-gold-500 border-gold-500 text-[#160F02]`
 * (the "active pill" treatment) is allowed to be written out — every
 * other single-select pill/toggle in the app should render through here
 * rather than re-typing those three classes, or the active-state color
 * drifts out of sync the next time this file changes. The optional
 * `icon` field exists so a richer toggle (e.g. Characters' Search/
 * Describe mode switch) doesn't need its own hand-rolled button just to
 * fit an icon next to the label.
 */
export function FilterPillGroup({
  options,
  value,
  onChange,
  className,
}: {
  options: FilterPillOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn("flex gap-2 overflow-x-auto no-scrollbar", className)}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "shrink-0 inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-colors duration-150 ease-premium",
              active
                ? "bg-gold-500 border-gold-500 text-[#160F02]"
                : "border-border-hairline text-text-secondary hover:text-text-primary hover:border-white/20"
            )}
          >
            {opt.icon}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

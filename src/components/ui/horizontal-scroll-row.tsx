"use client";

import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Used by Featured Companions + Popular Companions rows (§4). Native
 * scroll + snap, with a desktop-only arrow affordance layered on top —
 * matches §6 "native scroll + optional arrow affordance, snap-to-card".
 */
export function HorizontalScrollRow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  function scrollBy(dir: 1 | -1) {
    ref.current?.scrollBy({ left: dir * 320, behavior: "smooth" });
  }

  return (
    <div className="relative group/row">
      <div
        ref={ref}
        className={cn(
          "flex gap-4 overflow-x-auto no-scrollbar scroll-smooth pb-1",
          className
        )}
      >
        {children}
      </div>
      <button
        aria-label="Scroll left"
        onClick={() => scrollBy(-1)}
        className="hidden md:flex absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 h-10 w-10 items-center justify-center rounded-full bg-base border border-border-hairline text-text-primary opacity-0 group-hover/row:opacity-100 transition-[opacity,border-color,transform] duration-200 ease-premium hover:border-gold-500/50 hover:scale-105"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <button
        aria-label="Scroll right"
        onClick={() => scrollBy(1)}
        className="hidden md:flex absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 h-10 w-10 items-center justify-center rounded-full bg-base border border-border-hairline text-text-primary opacity-0 group-hover/row:opacity-100 transition-[opacity,border-color,transform] duration-200 ease-premium hover:border-gold-500/50 hover:scale-105"
      >
        <ChevronRight className="h-5 w-5" />
      </button>
    </div>
  );
}

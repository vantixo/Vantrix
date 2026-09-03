"use client";

import { useShellStore } from "./shell-store";
import { cn } from "@/lib/utils";

/**
 * STATIC-RAIL FIX companion: Sidebar switched from `sticky` to `fixed`
 * (see sidebar.tsx's own doc comment) so it's truly pinned to the
 * viewport and can never be carried along by a page scroll. A fixed
 * element sits outside normal flow though, so the flex layout in
 * (app)/layout.tsx no longer reserves its 76px/240px automatically —
 * without this, page content would render underneath the rail.
 *
 * Reads the same railCollapsed flag Sidebar itself reads (useShellStore)
 * so the two stay in lockstep on every toggle/breakpoint change, and
 * mirrors Sidebar's own width values and transition timing exactly.
 * `md:` prefixed since Sidebar only renders `hidden md:flex` — below
 * that breakpoint there's no rail to clear, so no offset is applied.
 */
export function MainOffset({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const railCollapsed = useShellStore((s) => s.railCollapsed);

  return (
    <div
      className={cn(
        className,
        "transition-[margin-left] duration-200 ease-premium",
        railCollapsed ? "md:ml-[76px]" : "md:ml-[240px]"
      )}
    >
      {children}
    </div>
  );
}

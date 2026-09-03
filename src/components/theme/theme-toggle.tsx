"use client";

import { Sparkles } from "lucide-react";
import { useThemeStore } from "@/lib/theme/theme-store";
import { THEME_META } from "@/lib/theme/constants";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * One-click quick-switch, cycling gold → nova → velvet → aurora → gold.
 * Rendered as a bare icon button (`variant="icon"`, the default) in
 * PublicHeader (signed-out visitors, every breakpoint) — and, in the authenticated
 * shell, as a labeled sidebar-footer row (`variant="sidebar"`) in
 * Sidebar, in the slot the Upgrade CTA used to occupy there (see
 * sidebar.tsx's SIDEBAR/TOP-BAR SWAP comment: Upgrade moved to TopBar's
 * icon slot, this moved into the sidebar footer in its place, matching
 * the existing Collapse row's label+icon treatment rather than staying a
 * bare h-10 w-10 button in a spot that now expects a full-width row).
 *
 * The sidebar variant owns its own collapsed-state Tooltip internally,
 * the same way NavLink wraps itself rather than being wrapped by its
 * parent (see nav-link.tsx) — it's the only row-rendering component in
 * the sidebar file, so it should follow the same self-contained pattern
 * as the others, and a `title` attribute plus an externally-applied
 * Radix Tooltip on the same element would otherwise stack into two
 * overlapping tooltips on hover once the rail is collapsed. The bare
 * `variant="icon"` button (never wrapped in a Tooltip anywhere it's
 * used) keeps `title` as its only hover affordance.
 *
 * With four themes, aria-pressed (a boolean) no longer describes this
 * control accurately — swapped for aria-label/title stating current
 * theme and what one more click does, which is the correct pattern for
 * a cycling (as opposed to two-state toggle) button. For a named,
 * pick-directly choice instead of cycling, see the Settings page's
 * ThemePicker, which calls setTheme() with a specific value.
 *
 * Renders as a neutral icon before hydration, then colors itself in once
 * useThemeStore has synced with the DOM (see theme-hydration.tsx) — this
 * is the one piece of UI in the whole system that's aware of theme state
 * in React rather than pure CSS, so it's the one piece that needs the
 * mount guard.
 */
export function ThemeToggle({
  variant = "icon",
  collapsed = false,
}: {
  variant?: "icon" | "sidebar";
  /** Sidebar-only: rail is collapsed to icon-only width — hide the label
   *  and switch the hover affordance from visible text to a Tooltip. */
  collapsed?: boolean;
}) {
  const theme = useThemeStore((s) => s.theme);
  const hasHydrated = useThemeStore((s) => s.hasHydrated);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);

  const current = hasHydrated ? theme : "gold";
  const isDefault = current === "gold";
  const ariaLabel = `Theme: ${THEME_META[current].label}. Click to switch.`;
  const title = `${THEME_META[current].label} theme — click to cycle`;

  if (variant === "sidebar") {
    const row = (
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={ariaLabel}
        className={cn(
          "h-auto w-full flex items-center gap-3 rounded-xs px-3 py-2.5 text-sm font-medium transition-colors ease-premium",
          collapsed && "justify-center px-0",
          isDefault
            ? "text-text-secondary hover:text-text-primary hover:bg-white/[0.04]"
            : "text-gold-400 hover:bg-gold-500/10"
        )}
      >
        <Sparkles className="h-5 w-5 shrink-0" strokeWidth={1.75} />
        {!collapsed && (
          <span className="whitespace-nowrap">{THEME_META[current].label}</span>
        )}
      </button>
    );

    // Matches Tooltip's own contract (tooltip.tsx): reserved for
    // icon-only UI with no visible label, so only mounted when collapsed
    // — an expanded row already shows THEME_META[current].label as text.
    return collapsed ? (
      <Tooltip content={title} side="right">
        {row}
      </Tooltip>
    ) : (
      row
    );
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={ariaLabel}
      title={title}
      className={cn(
        "h-10 w-10 flex items-center justify-center rounded-xs transition-colors ease-premium",
        isDefault
          ? "text-text-secondary hover:text-text-primary hover:bg-white/[0.04]"
          : "text-gold-400 hover:bg-gold-500/10"
      )}
    >
      <Sparkles className="h-5 w-5" strokeWidth={1.75} />
    </button>
  );
}

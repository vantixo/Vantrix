"use client";

import { Check } from "lucide-react";
import { useThemeStore } from "@/lib/theme/theme-store";
import { THEMES, THEME_META, type ThemeName } from "@/lib/theme/constants";
import { cn } from "@/lib/utils";

/**
 * The "theme setting in the app setting" surface — a named, pick-directly
 * choice (unlike the topbar's cycling ThemeToggle). Each card previews
 * its theme's actual base + accent colors as inline swatches rather than
 * a text label alone, since "which one is nova vs velvet" isn't
 * guessable from a name — seeing the palette is what actually lets
 * someone choose.
 *
 * Swatch colors are hardcoded hex here (not read from CSS variables)
 * deliberately: this card needs to show all four themes' colors
 * *simultaneously*, including the three that aren't currently active and
 * therefore have no live CSS variable to read from. This is the one
 * sanctioned exception to "never hardcode a theme color in a component"
 * — everywhere else in the app still goes through the CSS-variable
 * mechanism untouched. Values must match globals.css's --gold-500 per
 * theme exactly — velvet's in particular was corrected once already
 * (see arch-theme-velvet-contrast.test.ts) after an earlier value read
 * fine here but failed WCAG AA against the accent-on-dark button text.
 */
const SWATCHES: Record<ThemeName, { base: string; accent: string }> = {
  gold: { base: "#0A0A0A", accent: "#C9A15A" },
  nova: { base: "#0A0710", accent: "#BB6CDA" },
  velvet: { base: "#12080A", accent: "#C66444" },
  aurora: { base: "#0D080F", accent: "#C1679A" },
};

export function ThemePicker() {
  const theme = useThemeStore((s) => s.theme);
  const hasHydrated = useThemeStore((s) => s.hasHydrated);
  const setTheme = useThemeStore((s) => s.setTheme);

  const current = hasHydrated ? theme : "gold";

  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {THEMES.map((t) => {
        const meta = THEME_META[t];
        const swatch = SWATCHES[t];
        const active = current === t;
        return (
          <button
            key={t}
            type="button"
            onClick={() => setTheme(t)}
            aria-pressed={active}
            className={cn(
              "text-left rounded-md border p-4 transition-colors ease-premium",
              active
                ? "border-gold-500/60"
                : "border-border-hairline hover:border-white/20"
            )}
          >
            <div
              className="h-14 rounded-sm mb-3 relative overflow-hidden border border-white/10"
              style={{ backgroundColor: swatch.base }}
            >
              <span
                className="absolute bottom-2 left-2 h-4 w-4 rounded-full"
                style={{ backgroundColor: swatch.accent }}
              />
              <span
                className="absolute bottom-2 left-8 right-2 h-1.5 rounded-full opacity-70"
                style={{ backgroundColor: swatch.accent }}
              />
            </div>
            <div className="flex items-center gap-1.5 mb-1">
              <p className="text-sm font-medium text-text-primary">{meta.label}</p>
              {active && <Check className="h-3.5 w-3.5 text-gold-500" />}
            </div>
            <p className="text-xs text-text-secondary leading-snug">
              {meta.description}
            </p>
          </button>
        );
      })}
    </div>
  );
}

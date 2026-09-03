/**
 * Shared theme constants — imported by both client (store, toggle,
 * settings picker) and the beforeInteractive init script
 * (public/theme-init.js, which duplicates the literal values below by
 * hand since it can't import TS — keep them in sync if either changes).
 *
 * Four themes: "gold" (default) plus three opt-in alternates, "nova",
 * "velvet", and "aurora" — see arch-15-gold-theme-is-default.test.ts and
 * arch-theme-nova-system.test.ts, which don't assert "exactly one
 * alternate" but do assert "exactly these alternates, added
 * deliberately through the CSS-variable mechanism, not an open-ended
 * per-user skin matrix." Adding a fifth theme later means updating
 * those tests' final assertions on purpose, same as this file's own
 * history already did for nova, velvet, and aurora in turn.
 */
export const THEMES = ["gold", "nova", "velvet", "aurora"] as const;
export type ThemeName = (typeof THEMES)[number];

export const DEFAULT_THEME: ThemeName = "gold";

/** Display metadata for the Settings page's theme picker (§ theme-picker.tsx).
 *  Kept here rather than inline in the component so the picker, the quick
 *  topbar toggle, and any future surface all describe each theme the same way. */
export const THEME_META: Record<
  ThemeName,
  { label: string; description: string }
> = {
  gold: {
    label: "Gold",
    description: "The original black & gold — premium, restrained, default.",
  },
  nova: {
    label: "Nova",
    description: "Cosmic violet-to-magenta — bold, after-dark, expressive.",
  },
  velvet: {
    label: "Velvet",
    description: "Deep terracotta & warm rust — intimate, romantic, mature.",
  },
  aurora: {
    label: "Aurora",
    description: "Violet-to-warm-gold dusk — cinematic, elegant, emotionally warm.",
  },
};

/** localStorage key. Must match THEME_STORAGE_KEY in public/theme-init.js. */
export const THEME_STORAGE_KEY = "vantrix-theme";

/** Browser-chrome tint per theme (kept in sync with --theme-meta-color in
 *  globals.css) — applied client-side in theme-provider.tsx since
 *  <meta name="theme-color"> can't itself read a CSS custom property. */
export const THEME_META_COLOR: Record<ThemeName, string> = {
  gold: "#0A0A0A",
  nova: "#0A0710",
  velvet: "#12080A",
  aurora: "#0D080F",
};

export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

"use client";

import { create } from "zustand";
import { DEFAULT_THEME, THEMES, THEME_META_COLOR, THEME_STORAGE_KEY, isThemeName, type ThemeName } from "./constants";

interface ThemeState {
  theme: ThemeName;
  /** False until the store has read the real value off the DOM/localStorage
   *  on the client. Consumers that render theme-dependent UI (the toggle's
   *  own label/icon) must gate on this and show a neutral state until it
   *  flips — otherwise the server-rendered "gold" guess and a returning
   *  nova visitor's real client value mismatch during hydration. The
   *  colors themselves don't have this problem: public/theme-init.js sets
   *  data-theme on <html> directly, outside React, before first paint. */
  hasHydrated: boolean;
  setTheme: (next: ThemeName) => void;
  toggleTheme: () => void;
}

/**
 * Plain zustand store (matches shell-store.ts's pattern — no persist
 * middleware) rather than deriving theme from data-theme via a selector,
 * because this store is the single place that *writes* the three things a
 * theme change touches: the DOM attribute (drives every CSS var, i.e. the
 * actual visual re-skin), localStorage (drives repeat visits, read
 * synchronously by public/theme-init.js before this module even loads),
 * and the theme-color meta tag (drives mobile browser chrome tint).
 * Components should only ever call setTheme/toggleTheme, never touch
 * document.documentElement.dataset.theme directly.
 */
export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: DEFAULT_THEME,
  hasHydrated: false,
  setTheme: (next) => {
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = next;
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", THEME_META_COLOR[next]);
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // Private browsing / storage disabled — theme still applies for
        // this session via the DOM attribute above, just won't persist.
      }
    }
    set({ theme: next, hasHydrated: true });
  },
  /** Cycles gold → nova → velvet → aurora → gold. Used by the topbar's
   *  one-click quick-switch; the Settings page's ThemePicker calls
   *  setTheme() directly instead, since jumping straight to a named
   *  choice is more useful than cycling once there are four options. */
  toggleTheme: () => {
    const current = get().theme;
    const idx = THEMES.indexOf(current);
    const next = THEMES[(idx + 1) % THEMES.length];
    get().setTheme(next);
  },
}));

/**
 * Called once on mount by ThemeProvider. Reads whatever
 * public/theme-init.js already applied to the DOM (so this never
 * overwrites a nova visitor back to gold) and marks the store hydrated.
 * Safe to call more than once — subsequent calls are no-ops once hydrated.
 */
export function hydrateThemeStore() {
  if (useThemeStore.getState().hasHydrated) return;
  if (typeof document === "undefined") return;
  const domTheme = document.documentElement.dataset.theme;
  const theme = isThemeName(domTheme) ? domTheme : DEFAULT_THEME;
  useThemeStore.setState({ theme, hasHydrated: true });
}

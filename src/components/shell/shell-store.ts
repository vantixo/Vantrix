"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface ShellState {
  /** Desktop rail: collapsed (icon-only) vs expanded (icon+label). */
  railCollapsed: boolean;
  toggleRail: () => void;
  /**
   * Sets the rail state from responsive breakpoint logic (§5's tablet
   * bridge), not a user click. Kept separate from toggleRail so it never
   * marks railUserSet — see setRailCollapsedFromBreakpoint below.
   */
  setRailCollapsedFromBreakpoint: (collapsed: boolean) => void;
  /** True once the user has manually toggled the rail — after that, the
   *  breakpoint default (§5) stops overriding their explicit choice. */
  railUserSet: boolean;
  /** Mobile: full overlay drawer open/closed. */
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
}

/**
 * §9 Open Question 2 resolved: desktop (≥1024px) rail defaults to
 * EXPANDED. A premium companion product benefits from labeled nav on
 * first load rather than asking users to learn icons; power users can
 * collapse it themselves.
 *
 * §5's separate tablet-bridge rule (768–1024px defaults to the collapsed
 * rail) is applied responsively by Sidebar via setRailCollapsedFromBreakpoint,
 * not baked in as a single static initial value here — a static default
 * can only be right for one breakpoint range at a time.
 *
 * PERSISTENCE (sidebar upgrade pass): railCollapsed/railUserSet now
 * survive a reload via localStorage ("vantrix-sidebar") — this was
 * flagged as a deliberate follow-up in this file's own prior history
 * ("left as a follow-up ... once the account-menu settings surface
 * exists"), and that surface (profile/settings) now does. Uses
 * skipHydration + a manual rehydrate() call from Sidebar's own mount
 * effect (see sidebar.tsx) rather than reading localStorage eagerly at
 * module scope — mirrors theme-store.ts's hasHydrated/
 * hydrateThemeStore() pattern exactly, for the same reason: the server
 * render and the very first client paint both use the plain in-memory
 * default (expanded), so there is no SSR/client hydration mismatch on
 * the rail's width; a returning user's real persisted value applies one
 * effect-tick later instead. drawerOpen is deliberately NOT persisted —
 * it's momentary UI state, and reloading with the drawer stuck open
 * would be a bug, not a feature.
 */
export const useShellStore = create<ShellState>()(
  persist(
    (set) => ({
      railCollapsed: false,
      toggleRail: () => set((s) => ({ railCollapsed: !s.railCollapsed, railUserSet: true })),
      setRailCollapsedFromBreakpoint: (collapsed) =>
        set((s) => (s.railUserSet ? s : { railCollapsed: collapsed })),
      railUserSet: false,
      drawerOpen: false,
      setDrawerOpen: (open) => set({ drawerOpen: open }),
    }),
    {
      name: "vantrix-sidebar",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (s) => ({ railCollapsed: s.railCollapsed, railUserSet: s.railUserSet }),
    }
  )
);

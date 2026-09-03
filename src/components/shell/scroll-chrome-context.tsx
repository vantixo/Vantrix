"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useHideOnScroll } from "@/hooks/use-hide-on-scroll";

/**
 * DUPLICATE-LISTENER FIX: TopBar and BottomNav both need the same
 * "should chrome be hidden right now" boolean, and both used to get it
 * by calling useHideOnScroll() themselves — two independent `scroll`
 * listeners and two independent rAF loops recomputing the identical
 * value off the identical window.scrollY on every scroll frame. This
 * provider calls the hook exactly once (in (app)/layout.tsx, wrapping
 * both consumers) and hands the result down via context, so there's one
 * listener for the whole shell, not one per chrome surface.
 */
const ScrollChromeContext = createContext(false);

export function ScrollChromeProvider({ children }: { children: ReactNode }) {
  const hidden = useHideOnScroll();
  return (
    <ScrollChromeContext.Provider value={hidden}>{children}</ScrollChromeContext.Provider>
  );
}

export function useScrollChromeHidden() {
  return useContext(ScrollChromeContext);
}

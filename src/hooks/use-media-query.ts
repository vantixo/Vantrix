"use client";

import { useEffect, useState } from "react";

/**
 * Dependency-free matchMedia wrapper. Returns false on the server and on
 * first client render (avoids a hydration mismatch), then syncs to the
 * real value in an effect and stays in sync across resizes.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);

    const listener = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", listener);
    return () => mql.removeEventListener("change", listener);
  }, [query]);

  return matches;
}

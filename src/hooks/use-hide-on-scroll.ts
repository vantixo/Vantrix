"use client";

import { useEffect, useRef, useState } from "react";

/**
 * SCROLL-CHROME-HIDE FIX (per direct request): TopBar/BottomNav are
 * `sticky`/`fixed` and stay pinned through every scroll — on mobile that
 * permanently eats ~7.5rem of a viewport that's already short, right when
 * the person is trying to actually read a chat or scroll a feed. This
 * hook returns `true` while the page should hide that chrome: scrolling
 * down past a small threshold. Scrolling back up, or being within
 * `revealThreshold` of the top, shows it again — the standard mobile
 * pattern (Twitter/Instagram/etc), not a one-way disappearance, so the
 * bars are never actually unreachable, just out of the way while
 * actively scrolling down.
 *
 * `threshold` guards against hiding on a 2px scroll-bounce/rubber-band
 * jitter (iOS overscroll in particular fires tiny scroll events even
 * when the user hasn't intentionally scrolled). Passive + rAF-throttled
 * listener so this doesn't add scroll jank of its own.
 */
export function useHideOnScroll({
  threshold = 8,
  revealThreshold = 32,
}: { threshold?: number; revealThreshold?: number } = {}) {
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);
  const ticking = useRef(false);

  useEffect(() => {
    lastY.current = window.scrollY;

    const onScroll = () => {
      if (ticking.current) return;
      ticking.current = true;

      requestAnimationFrame(() => {
        const y = window.scrollY;

        if (y <= revealThreshold) {
          setHidden(false);
          lastY.current = y;
        } else {
          // ACCUMULATION FIX: only advance the comparison baseline when a
          // show/hide decision actually fires. Previously `lastY.current`
          // was reassigned to `y` on every rAF tick regardless of whether
          // `delta` crossed the threshold — so a slow, smooth scroll
          // (many small ~2-5px frames, the common case for touch, as
          // opposed to a single fast flick) never accumulated enough
          // per-frame delta to cross `threshold` and the bars never hid.
          // Leaving the baseline untouched below-threshold lets small
          // same-direction movements accumulate across frames until they
          // do cross it.
          const delta = y - lastY.current;
          if (delta > threshold) {
            setHidden(true);
            lastY.current = y;
          } else if (delta < -threshold) {
            setHidden(false);
            lastY.current = y;
          }
        }

        ticking.current = false;
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold, revealThreshold]);

  return hidden;
}

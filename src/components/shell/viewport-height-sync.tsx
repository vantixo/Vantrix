"use client";

import { useEffect } from "react";

/**
 * MOBILE-SEND-FIX (root cause): every full-bleed screen (chat-window.tsx,
 * roleplay-stage.tsx) sizes itself off `100dvh` and relies on the
 * `interactive-widget=resizes-content` viewport meta (see app/layout.tsx)
 * to make `dvh` actually shrink when the on-screen keyboard opens. That
 * meta value is Chromium-only — Safari/iOS (still the majority of "phone"
 * traffic) ignores it and keeps reporting the *layout* viewport for `dvh`,
 * unchanged, with the keyboard drawn on top instead. The composer's
 * `sticky bottom-0` then sticks to the bottom of that un-shrunk box, which
 * sits underneath the keyboard — visible, but its real hit-testable
 * position is off-screen, so taps on Send land on nothing. This is why it
 * only ever showed up "on phone": Chromium desktop and Chromium Android
 * both honored the meta and never reproduced it.
 *
 * Fix: don't trust any CSS unit to track the keyboard. `window.
 * visualViewport` (Safari 13+, every evergreen mobile browser) reports the
 * *actual* visible height directly and fires `resize` the moment the
 * keyboard opens/closes, so this writes that number into a `--vvh` custom
 * property on <html> that every full-bleed screen's height calc now reads
 * instead of `dvh`. Falls back to `window.innerHeight` for the handful of
 * browsers with no visualViewport API at all, so nothing regresses there.
 *
 * PERF: three things kept this from being "just add a resize listener":
 *   1. No `scroll` listener. visualViewport fires `scroll` on every pinch-
 *      zoom pan / pixel of momentum scroll — it tracks the viewport's
 *      *offset*, not its height, which is the only thing our CSS var
 *      needs. We only ever cared about `resize` (fired on keyboard
 *      show/hide); the scroll listener in the original version was pure
 *      overhead with zero effect on correctness.
 *   2. rAF-coalesced. iOS animates the keyboard in/out over several
 *      frames, firing `resize` repeatedly during that animation — each
 *      handled synchronously would mean a `style.setProperty` (a forced
 *      style recalc on every full-bleed screen reading the var) per
 *      event. Collapsing bursts to one write per animation frame is the
 *      standard fix for a hot resize/scroll handler.
 *   3. Writes are skipped unless the height actually changed by a whole
 *      pixel — visualViewport can report the same height across
 *      consecutive events (e.g. a scroll-triggered `resize` with no real
 *      size change), and an identical write still forces the same style
 *      recalc as a real one.
 */
export function ViewportHeightSync() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const vv = window.visualViewport;
    const root = document.documentElement;

    let rafId: number | null = null;
    let lastHeight = -1;

    function applyHeight() {
      rafId = null;
      const height = Math.round(vv?.height ?? window.innerHeight);
      if (height === lastHeight) return;
      lastHeight = height;
      root.style.setProperty("--vvh", `${height}px`);
    }

    function scheduleApply() {
      if (rafId !== null) return; // already coalescing this frame's burst
      rafId = requestAnimationFrame(applyHeight);
    }

    applyHeight();

    const target: VisualViewport | Window = vv ?? window;
    target.addEventListener("resize", scheduleApply);

    return () => {
      target.removeEventListener("resize", scheduleApply);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  return null;
}

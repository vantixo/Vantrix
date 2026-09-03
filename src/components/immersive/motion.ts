import type { Variants } from "framer-motion";

/**
 * Shared motion timing scale — Phase 1 Immersive UI Upgrade §18 ("Motion
 * Principles"): micro-interactions 100-250ms, page transitions 200-450ms,
 * cinematic moments 500-900ms max. Pure data (no "use client" needed) so
 * it can be imported from server components too.
 *
 * Easing reuses the exact cubic-bezier already shipped in
 * tailwind.config.ts's slide-in-left/slide-in-top keyframes, rather than
 * inventing a second easing curve for the same "settle in" feeling.
 */
export const EASE_VANTRIX = [0.16, 1, 0.3, 1] as const;

export const DURATION = {
  micro: 0.2,
  page: 0.35,
  cinematic: 0.7,
} as const;

export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: DURATION.page, ease: EASE_VANTRIX },
  },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: DURATION.micro, ease: EASE_VANTRIX },
  },
};

/** For hero/cinematic reveals only — spec §18's 500-900ms ceiling. */
export const cinematicReveal: Variants = {
  hidden: { opacity: 0, scale: 1.015 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: DURATION.cinematic, ease: EASE_VANTRIX },
  },
};

"use client";

import { motion, useReducedMotion } from "framer-motion";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { EASE_VANTRIX, DURATION } from "./motion";

/**
 * Cinematic *entrance* transition — scoped to the /characters route group
 * (see (app)/characters/layout.tsx) rather than applied app-wide.
 *
 * CRASH FIX (2026-09-01): this previously wrapped `{children}` in
 * framer-motion's <AnimatePresence mode="wait"> with an `exit` variant,
 * to get a real crossfade (old page animates out, then new page animates
 * in) instead of just an entrance. That doesn't work here and was the
 * cause of the "This page couldn't load — undefined is not an object
 * (evaluating 'd.ReactCurrentBatchConfig')" crash on every /characters
 * navigation: AnimatePresence's exit animation depends on being able to
 * keep the *outgoing* child mounted for a moment after it's removed from
 * the tree, but `children` here is a Server Component subtree (the async
 * CharactersPage, itself wrapped in its own <Suspense>) — the App Router
 * discards that RSC payload immediately on navigation rather than
 * leaving a stable fiber for AnimatePresence to hold onto and keep
 * re-rendering. The two were fighting over the same torn-down tree,
 * which is what surfaced as a bare React-internals crash rather than a
 * clean error. (This is a widely-documented incompatibility between
 * AnimatePresence exit animations and the App Router's page-swap
 * behavior, not something specific to this component — see e.g.
 * vercel/next.js#49279 and the various "FrozenRouter" workarounds, all
 * of which lean on unexposed Next internals and can break on any Next
 * upgrade. Not worth taking that risk for an exit flourish.)
 *
 * Dropping `exit` (and the `AnimatePresence` wrapper it required) keeps
 * the part that's actually cheap and safe: every new mount under this
 * layout — browse → detail, detail → detail — still plays the blur+scale
 * entrance below, because Next mounts a fresh `motion.div` (new `key`)
 * for it regardless. What's gone is only the outgoing page's fade-out,
 * which was the fragile half.
 *
 * WHY THIS DOESN'T LIVE ON (app)/layout.tsx: that layout wraps every
 * authenticated route (chat, dating, studio, ...). A blur+scale entrance
 * on *every* navigation would fight mid-typing chat inputs, swipe-deck
 * gesture state, and studio form state — all real interruption cost for
 * a cinematic flourish nobody asked for on those surfaces. Scoping to
 * the characters segment keeps the blast radius to exactly the
 * "immersive character" surfaces this was built for.
 *
 * Duration/easing reuse motion.ts's shared cinematic scale rather than
 * inventing new numbers, and `useReducedMotion` short-circuits to plain
 * children — no wrapper div, no transition — for anyone who needs that,
 * same as MotionWrapper.
 */
export function CharacterSectionTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) return <>{children}</>;

  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, scale: 0.985, filter: "blur(6px)" }}
      animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
      transition={{ duration: DURATION.cinematic, ease: EASE_VANTRIX }}
    >
      {children}
    </motion.div>
  );
}

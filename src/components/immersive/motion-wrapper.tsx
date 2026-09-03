"use client";

import { motion, useReducedMotion, type Variants } from "framer-motion";
import type { ReactNode } from "react";
import { fadeInUp } from "./motion";

/**
 * Phase 1 Immersive UI Upgrade §2/§18: reveal-on-scroll wrapper used
 * across the new immersive surfaces (hero, presence card, milestone
 * moments). Centralizing this in one place means "respect
 * prefers-reduced-motion" is enforced once, not re-implemented per
 * component — `useReducedMotion` (Framer Motion's own hook) short-circuits
 * to a plain, unanimated div rather than just shortening the duration, so
 * a reduced-motion user never sees the transform at all, not just a
 * faster version of it.
 *
 * `once: true` on the viewport check is deliberate — these are entrance
 * reveals, not scroll-jacking; re-triggering every time a card re-enters
 * the viewport reads as glitchy on a long scroll, not "cinematic".
 */
export function MotionWrapper({
  children,
  className,
  variants = fadeInUp,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  variants?: Variants;
  delay?: number;
}) {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-64px" }}
      variants={variants}
      transition={{ delay }}
    >
      {children}
    </motion.div>
  );
}

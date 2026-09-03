"use client";

import { motion, useMotionTemplate, useScroll, useTransform } from "framer-motion";

/**
 * The header starts fully transparent over the page background (both are
 * bg-base, so at scrollY=0 there's no visible seam at all — consistent
 * with FRONTEND_DIRECTIVE §1's "one background everywhere") and gains a
 * hairline border + backdrop blur only once content has actually scrolled
 * under it. That transition is the "signal" that content is passing
 * beneath a fixed surface, rather than a static bar sitting there from
 * the first frame.
 */
export function ScrollReactiveHeaderShade() {
  const { scrollY } = useScroll();
  const borderOpacity = useTransform(scrollY, [0, 80], [0, 0.08]);
  const blurPx = useTransform(scrollY, [0, 80], [0, 12]);
  const bgOpacity = useTransform(scrollY, [0, 80], [0, 0.7]);

  const borderColor = useMotionTemplate`rgba(255,255,255,${borderOpacity})`;
  const backdropFilter = useMotionTemplate`blur(${blurPx}px)`;
  const background = useMotionTemplate`rgba(10,10,10,${bgOpacity})`;

  return (
    <motion.div
      style={{ borderBottomColor: borderColor, backdropFilter, background }}
      className="absolute inset-0 border-b -z-10"
      aria-hidden
    />
  );
}

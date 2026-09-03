"use client";

import { motion, useScroll, useSpring } from "framer-motion";

/**
 * The admin shell's signature motion device: a hairline gold bar pinned
 * under the header that fills left-to-right with scroll progress through
 * the current page. Spring-smoothed so it reads as a live signal rather
 * than a literal 1:1 scrollbar — reinforcing "this is a control room
 * watching something in real time," which is the whole point of an ops
 * dashboard. Kept to a single 2px hairline so it never competes with the
 * gold-edge motif already reserved for interactive/premium surfaces
 * elsewhere in the app (FRONTEND_DIRECTIVE §1).
 */
export function ScrollSignalBar() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 300,
    damping: 40,
    mass: 0.2,
  });

  return (
    <motion.div
      style={{ scaleX }}
      className="fixed top-0 left-0 right-0 h-[2px] origin-left z-50 bg-gold-fill"
      aria-hidden
    />
  );
}

"use client";

import { useEffect, useRef } from "react";
import { useInView, useMotionValue, useSpring } from "framer-motion";

/**
 * Counts up from 0 to `value` once the number scrolls into view, using a
 * spring rather than a linear tween so it settles with a slight
 * deceleration — the same "premium" easing feel as the rest of the admin
 * motion system, just expressed through a number instead of a position.
 */
export function AnimatedCounter({
  value,
  format = (n) => Math.round(n).toLocaleString(),
  className,
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-10%" });
  const motionValue = useMotionValue(0);
  const spring = useSpring(motionValue, { stiffness: 90, damping: 22, mass: 1 });

  useEffect(() => {
    if (inView) motionValue.set(value);
  }, [inView, value, motionValue]);

  useEffect(() => {
    return spring.on("change", (v) => {
      if (ref.current) ref.current.textContent = format(v);
    });
  }, [spring, format]);

  return (
    <span ref={ref} className={className}>
      0
    </span>
  );
}

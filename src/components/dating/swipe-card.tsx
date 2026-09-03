"use client";

import { SafeImage as Image } from "@/components/ui/safe-image";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { resolveImageSrc } from "@/lib/utils";
import type { DeckCandidate, SwipeDirection } from "@/hooks/use-dating-deck";

/**
 * A swipe deck is the one place in this app where a real drag gesture is
 * the point of the interaction (unlike the hero/featured carousels, which
 * deliberately stuck to native scroll per §6). framer-motion is already a
 * restored dependency (§13) for exactly this kind of case.
 */
export function SwipeCard({
  candidate,
  onSwipe,
  isTop,
  index,
}: {
  candidate: DeckCandidate;
  onSwipe: (direction: SwipeDirection) => void;
  isTop: boolean;
  index: number;
}) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-12, 12]);
  const likeOpacity = useTransform(x, [20, 120], [0, 1]);
  const passOpacity = useTransform(x, [-120, -20], [1, 0]);

  function handleDragEnd(_: unknown, info: { offset: { x: number } }) {
    if (info.offset.x > 120) {
      animate(x, 400, { duration: 0.2, ease: "easeOut" });
      onSwipe("like");
    } else if (info.offset.x < -120) {
      animate(x, -400, { duration: 0.2, ease: "easeOut" });
      onSwipe("pass");
    } else {
      animate(x, 0, { type: "spring", stiffness: 400, damping: 30 });
    }
  }

  return (
    <motion.div
      className="absolute inset-0"
      style={
        isTop
          ? { x, rotate }
          : { scale: 1 - index * 0.04, y: index * 10, opacity: index < 3 ? 1 : 0 }
      }
      drag={isTop ? "x" : false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={1}
      onDragEnd={isTop ? handleDragEnd : undefined}
      whileTap={isTop ? { cursor: "grabbing" } : undefined}
    >
      <div className="relative h-full w-full overflow-hidden rounded-lg border border-border-hairline bg-base shadow-card">
        <Image
          src={resolveImageSrc(candidate.image_url)}
          alt={candidate.name}
          fill
          sizes="(max-width: 640px) 100vw, 420px"
          priority={index === 0}
          className="object-cover pointer-events-none"
          draggable={false}
        />
        <div
          className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent"
          aria-hidden
        />

        {isTop && (
          <>
            <motion.div
              style={{ opacity: likeOpacity }}
              className="absolute top-6 left-6 rounded-xs border-2 border-gold-400 px-3 py-1 text-lg font-bold uppercase tracking-wide text-gold-400 -rotate-12"
            >
              Like
            </motion.div>
            <motion.div
              style={{ opacity: passOpacity }}
              className="absolute top-6 right-6 rounded-xs border-2 border-text-secondary px-3 py-1 text-lg font-bold uppercase tracking-wide text-text-secondary rotate-12"
            >
              Pass
            </motion.div>
          </>
        )}

        <div className="absolute inset-x-0 bottom-0 p-5">
          <h2 className="font-display text-2xl text-text-primary">
            {candidate.name}
            {candidate.age && (
              <span className="font-sans text-lg text-text-secondary"> · {candidate.age}</span>
            )}
          </h2>
          {candidate.archetype && (
            <p className="mt-1 text-sm text-text-secondary">{candidate.archetype}</p>
          )}
          {candidate.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {candidate.tags.slice(0, 4).map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-border-hairline bg-black/40 px-2.5 py-1 text-xs text-text-secondary backdrop-blur-sm"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

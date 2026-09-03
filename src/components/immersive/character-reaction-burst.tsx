"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Heart, Gift, Sparkles } from "lucide-react";
import { useCharacterReaction, type CharacterReactionType } from "./character-reaction-context";
import { EASE_VANTRIX } from "./motion";

const REACTION_ICON: Record<CharacterReactionType, typeof Heart> = {
  like: Heart,
  gift: Gift,
  milestone: Sparkles,
};

/** Small scatter of offsets so the burst reads as several particles, not one icon scaling up. */
const PARTICLES = [
  { x: -18, y: -58, rotate: -18, delay: 0 },
  { x: 14, y: -74, rotate: 10, delay: 0.05 },
  { x: 34, y: -46, rotate: 22, delay: 0.1 },
  { x: -34, y: -40, rotate: -8, delay: 0.08 },
];

/**
 * Renders inside CharacterHero's relative/overflow-hidden portrait
 * container. Reads the shared reaction context (see
 * character-reaction-context.tsx) rather than taking a prop, so
 * CharacterHero doesn't need to know *why* the character is reacting —
 * any sibling under the same CharacterReactionProvider can cause this to
 * fire.
 *
 * A ring pulse (contained within the portrait's own rounded/
 * overflow-hidden bounds — no bleed past the frame) plus a handful of
 * particles drifting up and fading. AnimatePresence handles the
 * mount/unmount so the exit fade always completes even though the
 * context clears the reaction abruptly.
 */
export function CharacterReactionBurst() {
  const reaction = useCharacterReaction();
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) return null;

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden" aria-hidden>
      <AnimatePresence>
        {reaction && (
          <motion.div
            key={reaction.token}
            className="absolute inset-0 flex items-center justify-center"
          >
            {/* Glow ring, inset so it never clips past the portrait frame */}
            <motion.div
              className="absolute inset-4 rounded-lg ring-2 ring-gold-400/70"
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: [0, 0.9, 0], scale: 1.04 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.9, ease: EASE_VANTRIX }}
            />
            {PARTICLES.map((p, i) => {
              const Icon = REACTION_ICON[reaction.type];
              return (
                <motion.div
                  key={i}
                  className="absolute text-gold-400"
                  initial={{ opacity: 0, x: 0, y: 0, scale: 0.4, rotate: 0 }}
                  animate={{ opacity: [0, 1, 0], x: p.x, y: p.y, scale: 1, rotate: p.rotate }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 1.1, ease: EASE_VANTRIX, delay: p.delay }}
                >
                  <Icon className="h-5 w-5" fill="currentColor" strokeWidth={1} />
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

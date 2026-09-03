"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

/**
 * Character reactions — the portrait visibly responding to something the
 * user *did*, not just idling. Distinct from LivingPortrait's own
 * click/focus breathe loop (an ambient "I'm here" cue owned entirely by
 * the portrait itself): reactions are triggered by actions elsewhere on
 * the page (CharacterEngagement's like button today; a gift/milestone
 * event tomorrow) and need to reach the portrait, which is a sibling
 * component, not a parent/child. A small Context is the least-magic way
 * to bridge that without prop-drilling the trigger down through the
 * server-rendered page shell or reaching for a global event bus.
 *
 * Auto-clears itself after `durationMs` so the consumer never has to
 * remember to reset it — firing the same reaction again mid-animation
 * just restarts the clock (each trigger gets a token so a stale timeout
 * can't clear a newer reaction).
 */
export type CharacterReactionType = "like" | "gift" | "milestone";

type ReactionState = {
  type: CharacterReactionType;
  token: number;
} | null;

const CharacterReactionContext = createContext<{
  reaction: ReactionState;
  triggerReaction: (type: CharacterReactionType, durationMs?: number) => void;
} | null>(null);

export function CharacterReactionProvider({ children }: { children: ReactNode }) {
  const [reaction, setReaction] = useState<ReactionState>(null);
  const tokenRef = useRef(0);

  const triggerReaction = useCallback((type: CharacterReactionType, durationMs = 1600) => {
    const token = ++tokenRef.current;
    setReaction({ type, token });
    window.setTimeout(() => {
      // Only clear if nothing newer has fired since — prevents a stale
      // timeout from a rapid double-trigger cutting the latest one short.
      setReaction((current) => (current?.token === token ? null : current));
    }, durationMs);
  }, []);

  return (
    <CharacterReactionContext.Provider value={{ reaction, triggerReaction }}>
      {children}
    </CharacterReactionContext.Provider>
  );
}

/** Fire a reaction from anywhere under a CharacterReactionProvider (e.g. the like button). */
export function useTriggerCharacterReaction() {
  const ctx = useContext(CharacterReactionContext);
  // No-op outside a provider rather than throwing — keeps callers usable
  // on surfaces (grid cards, etc.) that don't opt into the reaction system.
  return ctx?.triggerReaction ?? (() => {});
}

/** Read the current reaction to render it (e.g. the portrait's burst overlay). */
export function useCharacterReaction() {
  const ctx = useContext(CharacterReactionContext);
  return ctx?.reaction ?? null;
}

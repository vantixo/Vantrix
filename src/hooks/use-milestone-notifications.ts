"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * WIRE-FIX: /api/notifications (see that route's own header) already
 * streams `milestone_unlocked` surprises over SSE — recordSurprise() in
 * chat/stream/route.ts writes them the moment a milestone is hit, and the
 * route enqueues a `surprise` event with `surpriseType: 'milestone_unlocked'`
 * within one POLL_INTERVAL_MS (8s) of that write. Nothing in the client ever
 * opened an EventSource to that endpoint, so milestones were recorded and
 * deliverable but never actually shown — this hook is that missing
 * subscriber. Scoped to the chat page rather than the root layout so it
 * only runs while a conversation is open, matching where a milestone
 * celebration is actually relevant.
 */
export interface MilestoneNotification {
  id: string;
  characterId: string;
  characterName: string;
  message: string;
  ctaUrl: string;
}

export function useMilestoneNotifications() {
  const [milestones, setMilestones] = useState<MilestoneNotification[]>([]);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const source = new EventSource("/api/notifications");
    sourceRef.current = source;

    source.addEventListener("surprise", (evt) => {
      try {
        const data = JSON.parse((evt as MessageEvent).data);
        if (data?.surpriseType !== "milestone_unlocked") return;
        setMilestones((prev) => [
          ...prev,
          {
            id: `${data.characterId}-${Date.now()}`,
            characterId: data.characterId,
            characterName: data.characterName,
            message: data.message,
            ctaUrl: data.ctaUrl,
          },
        ]);
      } catch {
        // Malformed event — drop it rather than crash the subscription.
      }
    });

    // Native SSE auto-reconnects on error; nothing to do here beyond
    // letting the browser retry (same assumption the route's own header
    // documents for its client).
    source.onerror = () => {};

    return () => {
      source.close();
      sourceRef.current = null;
    };
  }, []);

  const dismiss = useCallback((id: string) => {
    setMilestones((prev) => prev.filter((m) => m.id !== id));
  }, []);

  return { milestones, dismiss };
}

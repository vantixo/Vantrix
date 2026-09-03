"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Thin client wrapper around POST /api/conversations/ensure — the "Start
 * Chat" action from a character card or detail page. Deliberately calls
 * the route rather than reimplementing its find-or-create logic (see the
 * comment in lib/frontend/chat.ts for why that duplication is the thing
 * to avoid).
 */
export function useEnsureConversation() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startChat = useCallback(
    async (characterId: string) => {
      setError(null);
      setIsPending(true);
      try {
        const res = await fetch("/api/conversations/ensure", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ characterId }),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(body?.error ?? `Could not start chat (${res.status})`);
        }
        router.push(`/chat/${body.conversationId}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not start chat");
        setIsPending(false);
      }
    },
    [router]
  );

  return { startChat, isPending, error };
}

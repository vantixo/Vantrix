"use client";

import { useEffect, useRef } from "react";

/**
 * MOOD-SYNC-FIX: POST /api/dating/mood's own header comment claims "ChatWindow
 * now calls this endpoint on session end via the unmount/blur/visibility
 * handlers added in chat-window.tsx" — no such call existed anywhere in the
 * codebase. That route is what advances character_mood, checks first_chat/
 * deep_talk/week_streak/soulmate milestones, and advances prestige chapters,
 * so none of that ever fired from ordinary chatting. This hook is the
 * missing caller.
 *
 * Scoped deliberately: it only acts for characters the user has already
 * matched with (a dating_matches row exists) — it never creates one, unlike
 * gift-access's intentional get-or-create. A character the user has only
 * ever chatted with, never gifted/swiped/dated, stays out of the dating
 * system entirely, same as before this fix.
 *
 * "Session end" mirrors the route's own documented trigger: page unload,
 * tab hidden, or the component unmounting (navigating away) — whichever
 * happens first, and only once per mount, only if at least one assistant
 * reply was seen this session (matches the route's own totalMessages>=1
 * gate for first_chat).
 */
export function useDatingMoodSync({
  characterId,
  lastAssistantReply,
  messageCount,
}: {
  characterId: string;
  lastAssistantReply: string | null;
  messageCount: number;
}) {
  const matchIdRef = useRef<string | null | undefined>(undefined); // undefined = not yet resolved
  const stateRef = useRef({ lastAssistantReply, messageCount });
  const sentRef = useRef(false);

  stateRef.current = { lastAssistantReply, messageCount };

  useEffect(() => {
    let cancelled = false;
    matchIdRef.current = undefined;
    sentRef.current = false;

    fetch(`/api/dating/matches?characterId=${encodeURIComponent(characterId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled) matchIdRef.current = body?.matchId ?? null;
      })
      .catch(() => {
        if (!cancelled) matchIdRef.current = null;
      });

    function sync() {
      if (sentRef.current) return;
      const { lastAssistantReply: reply, messageCount: count } = stateRef.current;
      if (!matchIdRef.current || !reply || count < 1) return;
      sentRef.current = true;

      const payload = JSON.stringify({
        matchId: matchIdRef.current,
        lastReply: reply.slice(0, 2000),
        messageCount: count,
      });

      // navigator.sendBeacon survives page unload/tab close, unlike fetch;
      // falls back to a fire-and-forget fetch (e.g. component unmount from
      // in-app navigation, where the page itself isn't going away).
      if (typeof navigator !== "undefined" && navigator.sendBeacon) {
        const blob = new Blob([payload], { type: "application/json" });
        navigator.sendBeacon("/api/dating/mood", blob);
      } else {
        fetch("/api/dating/mood", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        }).catch(() => {});
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === "hidden") sync();
    }

    window.addEventListener("pagehide", sync);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      window.removeEventListener("pagehide", sync);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      sync(); // component unmounting — e.g. navigating to another chat
    };
    // Only re-run when the character (and thus the conversation) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId]);
}

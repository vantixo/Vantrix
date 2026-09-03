"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDown } from "lucide-react";
import { MessageBubble } from "./message-bubble";
import { ChatComposer } from "./chat-composer";
import { MilestoneToastStack } from "./milestone-toast";
import { MediaLightbox, type LightboxMedia } from "./media-lightbox";
import { useChatStream } from "@/hooks/use-chat-stream";
import { useVoicePlayback } from "@/hooks/use-voice-playback";
import { useMilestoneNotifications } from "@/hooks/use-milestone-notifications";
import { useGenerateMedia } from "@/hooks/use-generate-media";
import { useDatingMoodSync } from "@/hooks/use-dating-mood-sync";
import { usePaywall } from "@/components/paywall/paywall-provider";
import { getGuestTranscript, clearGuestTranscript } from "@/lib/guest-transcript";
import { safeRandomUUID } from "@/lib/utils";
import type { ChatMessage } from "@/lib/frontend/chat";

interface LocalMessage {
  id: string;
  // GIFT-ROLE FIX: was `"user" | "assistant"`, which forced toLocal()
  // below to collapse a DB `gift` row into "assistant" — see
  // message-bubble.tsx's GIFT-BUBBLE FIX comment for the visible bug
  // that caused. `role` is intentionally the open `string` the DB/API
  // already use (ChatMessage['role'] in lib/frontend/chat.ts) rather than
  // re-narrowing it here.
  role: string;
  content: string;
  imageUrl?: string | null;
  videoUrl?: string | null;
  status?: "sending" | "sent" | "failed";
}

// Near-bottom threshold (px) for the "am I already reading the latest
// message" check that drives auto-scroll — see the scroll effect below.
const NEAR_BOTTOM_PX = 120;

function newId(prefix: string): string {
  // WIRE-FIX: Date.now()-based ids (`user-${Date.now()}`) could collide —
  // a message pushed here and a media message pushed from
  // handleGenerateImage/Video in the same tick land on the same
  // millisecond often enough on fast devices, which broke React's `key`
  // uniqueness assumption.
  //
  // SECURE-CONTEXT FIX: crypto.randomUUID() is undefined on non-secure
  // origins (plain-HTTP LAN addresses like http://10.x.x.x:3000), and
  // this is the first statement inside handleSend() — the throw happened
  // before any state update ran, so the send button silently did nothing.
  // safeRandomUUID() falls back to crypto.getRandomValues(), which isn't
  // secure-context-gated.
  return `${prefix}-${safeRandomUUID()}`;
}

function toLocal(m: ChatMessage): LocalMessage {
  return {
    id: m.id,
    // GIFT-ROLE FIX: previously `m.role === "user" ? "user" : "assistant"`,
    // which mislabeled `gift` rows as the character's own dialogue. Only
    // collapse the *unexpected* case (neither user, assistant, nor gift)
    // to "assistant" as a safe default; pass the two roles the UI now
    // knows about straight through.
    role: m.role === "user" || m.role === "gift" ? m.role : "assistant",
    content: m.content,
    imageUrl: m.image_url,
    videoUrl: m.video_url,
    status: "sent",
  };
}

export function ChatWindow({
  conversationId,
  characterId,
  initialMessages,
}: {
  conversationId: string;
  characterId: string;
  initialMessages: ChatMessage[];
}) {
  const [messages, setMessages] = useState<LocalMessage[]>(
    initialMessages.map(toLocal)
  );
  const [draft, setDraft] = useState("");
  const [lightboxMedia, setLightboxMedia] = useState<LightboxMedia | null>(null);
  const [lowQuota, setLowQuota] = useState<{ remaining: number; limit: number } | null>(null);
  const sessionCountRef = useRef(
    initialMessages.filter((m) => m.role === "user").length
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  // Wraps just the message list (not the error/quota footers below it) —
  // see the ResizeObserver effect further down, which needs one stable
  // element whose height grows exactly when transcript content grows.
  const contentRef = useRef<HTMLDivElement>(null);
  // Ref (not just state) so the scroll-follow effect can read the latest
  // value without re-running every time the user scrolls — only new
  // content arriving should trigger the "should I follow?" decision.
  const isNearBottomRef = useRef(true);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [hasNewBelow, setHasNewBelow] = useState(false);
  // NO-DOWN-NAV FIX: the very first scroll-to-bottom (opening a
  // conversation) used the same "smooth" animation as a normal new
  // message, which visibly starts the chat scrolled up and drifts down —
  // exactly the "I have to scroll down to reach the bottom" feeling this
  // is meant to eliminate. Flips to `false` after that first run so every
  // scroll after that still animates normally.
  const isInitialScrollRef = useRef(true);

  // GUEST-CHAT-WIRE-FIX: POST /api/chat/claim-guest-transcript existed
  // fully built (idempotent — only ever backfills a still-empty
  // conversation) but had zero callers; its own doc comment says it's
  // meant to be "called once by ChatWindow right after the post-signup
  // redirect lands." Mirrors the server's own idempotency guard client-side
  // (initialMessages.length > 0 means this conversation already has real
  // content — never touch it) before spending a network round trip on a
  // claim that would just no-op anyway. A guest's transcript only exists in
  // localStorage in the first place if GuestChatWidget (the public
  // companion page) wrote one — see src/lib/guest-transcript.ts.
  useEffect(() => {
    if (initialMessages.length > 0) return;
    const transcript = getGuestTranscript(characterId);
    if (!transcript || transcript.length === 0) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/chat/claim-guest-transcript", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ characterId, messages: transcript }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          if (data.claimed && !cancelled) {
            setMessages((prev) =>
              prev.length > 0
                ? prev
                : transcript.map((m) => ({
                    id: newId(m.role),
                    role: m.role,
                    content: m.content,
                    status: "sent" as const,
                  }))
            );
            sessionCountRef.current = transcript.filter((m) => m.role === "user").length;
          }
          // Resolved either way (claimed, or found the conversation
          // non-empty after all — a race with another tab) — nothing left
          // for this transcript to do either way.
          clearGuestTranscript(characterId);
        }
        // Non-OK response: leave the transcript in place so a later mount
        // (e.g. reopening the chat) can retry the claim.
      } catch {
        // Network failure — same reasoning, leave it for a retry.
      }
    })();

    return () => {
      cancelled = true;
    };
    // Mount-only: initialMessages/characterId are stable for this
    // component's lifetime (a new conversation is a new page mount).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // GIFT-LIVE-FIX: /api/dating/gifts (see that route's GIFT-CHAT-FIX /
  // GIFT-ACK-FIX comments) inserts the gift line and the character's
  // in-character reply directly into `messages` from a fire-and-forget
  // block *after* responding to the gift request — this window's own
  // `messages` state has no way to know that happened, so the gift and
  // her reaction were invisible until the next full page load (exactly
  // what the screenshots showing "You sent a Bubble Tea" only *after* a
  // reload were actually capturing). GiftDrawer dispatches a
  // `vantrix:gift-sent` CustomEvent on the same characterId once the
  // send itself succeeds; this briefly polls the conversation's latest
  // page and appends whatever wasn't already rendered.
  //
  // HARDEN/OPTIMIZE pass: the original version fired three bare
  // setTimeouts per event with no way to cancel them — leaving the chat
  // (composer navigates away, or the character switches conversations)
  // inside that ~4.5s window left orphaned timers that would still
  // `setState` on an unmounted component (a real leak/warning source,
  // not hypothetical: gift sends are a normal, frequent action). Now
  // tracked via a per-mount `cancelled` flag plus an AbortController per
  // request, both cleaned up on unmount, and each scheduled attempt
  // checks a shared `done` flag so a poll that already found the new
  // rows skips the remaining network calls instead of always burning
  // all three.
  useEffect(() => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const controllers: AbortController[] = [];

    function onGiftSent(e: Event) {
      const detail = (e as CustomEvent<{ characterId?: string }>).detail;
      if (detail?.characterId !== characterId) return;
      let done = false;
      const delays = [1200, 2600, 4500];
      delays.forEach((delay) => {
        const timer = setTimeout(async () => {
          if (cancelled || done) return;
          const controller = new AbortController();
          controllers.push(controller);
          try {
            const res = await fetch(`/api/conversations/${conversationId}/messages`, {
              signal: controller.signal,
            });
            const body = await res.json().catch(() => null);
            if (cancelled) return;
            const fresh: ChatMessage[] | undefined = body?.messages;
            if (!fresh?.length) return;
            setMessages((prev) => {
              const known = new Set(prev.map((m) => m.id));
              const additions = fresh.filter((m) => !known.has(m.id)).map(toLocal);
              if (additions.length > 0) done = true;
              return additions.length > 0 ? [...prev, ...additions] : prev;
            });
          } catch {
            // Aborted (unmount) or network failure — the next scheduled
            // attempt, if any, can still pick it up.
          }
        }, delay);
        timers.push(timer);
      });

    }
    window.addEventListener("vantrix:gift-sent", onGiftSent);
    return () => {
      cancelled = true;
      window.removeEventListener("vantrix:gift-sent", onGiftSent);
      timers.forEach(clearTimeout);
      controllers.forEach((c) => c.abort());
    };
  }, [characterId, conversationId]);

  const {
    play: playVoice,
    playingId: voicePlayingId,
    loadingId: voiceLoadingId,
    error: voiceError,
    clearError: clearVoiceError,
  } = useVoicePlayback();

  const { openPaywallForError } = usePaywall();
  const { sendMessage, stop, streamingText, isStreaming, isQueued, error } = useChatStream({
    conversationId,
    characterId,
    onDone: (fullText, meta) => {
      setMessages((prev) => [
        ...prev,
        { id: newId("assistant"), role: "assistant", content: fullText, status: "sent" },
      ]);
      // Nudge only once a free/capped user is close to the wall — not
      // worth showing at all for effectively-unlimited tiers, so this
      // only lights up on a genuinely low, finite remaining count.
      if (meta.perCharacterRemaining && meta.perCharacterRemaining.limit <= 50) {
        setLowQuota(
          meta.perCharacterRemaining.remaining <= 3 ? meta.perCharacterRemaining : null
        );
      }
    },
  });

  // Scoped to this character: a milestone for a different companion is
  // still delivered (notifications inbox, see notifications-list.tsx) but
  // shouldn't pop up over an unrelated conversation.
  const { milestones, dismiss: dismissMilestone } = useMilestoneNotifications();
  const activeMilestones = milestones.filter((m) => m.characterId === characterId);

  const {
    generateImage,
    generateVideo,
    isGeneratingImage,
    isGeneratingVideo,
    error: mediaError,
    clearError: clearMediaError,
  } = useGenerateMedia({ characterId, conversationId });

  const lastAssistantMessage = [...messages].reverse().find((m) => m.role === "assistant");
  useDatingMoodSync({
    characterId,
    lastAssistantReply: lastAssistantMessage?.content ?? null,
    messageCount: sessionCountRef.current,
  });

  function mediaPromptContext(): string {
    // The generation routes require non-empty scene context; the current
    // draft (if the user typed something before tapping camera/video) is
    // the most relevant signal, falling back to the last message so a
    // photo/video can still be requested from an empty composer.
    if (draft.trim()) return draft.trim();
    const last = messages[messages.length - 1];
    return last?.content?.trim() || "Send a photo of yourself right now.";
  }

  async function handleGenerateImage() {
    const result = await generateImage(mediaPromptContext());
    if (result) {
      setMessages((prev) => [
        ...prev,
        { id: result.messageId ?? newId("image"), role: "assistant", content: "", imageUrl: result.url, status: "sent" },
      ]);
    }
  }

  async function handleGenerateVideo() {
    const result = await generateVideo(mediaPromptContext());
    if (result) {
      setMessages((prev) => [
        ...prev,
        { id: result.messageId ?? newId("video"), role: "assistant", content: "", videoUrl: result.url, status: "sent" },
      ]);
    }
  }

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distanceFromBottom < NEAR_BOTTOM_PX;
    isNearBottomRef.current = near;
    setIsNearBottom(near);
    if (near) setHasNewBelow(false);
  }

  // UX-FIX: previously this force-scrolled to bottom on every new message
  // or streaming delta unconditionally, which yanked the view back down
  // out from under anyone who'd scrolled up to reread earlier messages.
  // Now it only auto-follows while the reader is already at/near the
  // bottom; otherwise it surfaces a "new message" pill instead of moving
  // the viewport for them.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (isNearBottomRef.current) {
      // NO-DOWN-NAV FIX: first run (mount / conversation open) snaps
      // instantly instead of animating — see isInitialScrollRef above.
      const behavior: ScrollBehavior =
        isInitialScrollRef.current || streamingText ? "auto" : "smooth";
      el.scrollTo({ top: el.scrollHeight, behavior });
      isInitialScrollRef.current = false;
    } else if (messages.length > 0) {
      setHasNewBelow(true);
    }
  }, [messages, streamingText]);

  // MEDIA-SCROLL FIX: a message's photo/video loads asynchronously and can
  // grow the transcript's height well after the effect above already ran
  // (that one only fires on a new message arriving or streamed text
  // changing, not on a later image `load` event) — so a reader sitting at
  // the bottom would silently fall out of view the moment a photo finished
  // loading, with nothing to tell them content had shifted underneath
  // them, and no way back down except scrolling manually. A
  // ResizeObserver on the message-list wrapper re-checks "am I still
  // supposed to be at the bottom?" on every height change, whatever
  // caused it — new bubble, image finishing a load, a thought chip
  // expanding — not just the two triggers the effect above already covers.
  useEffect(() => {
    const contentEl = contentRef.current;
    const scrollEl = scrollRef.current;
    if (!contentEl || !scrollEl || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (isNearBottomRef.current) {
        scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: "auto" });
      }
    });
    observer.observe(contentEl);
    return () => observer.disconnect();
  }, []);

  function jumpToLatest() {
    const el = scrollRef.current;
    if (!el) return;
    isNearBottomRef.current = true;
    setIsNearBottom(true);
    setHasNewBelow(false);
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }

  // Shared by a fresh send and a retry — a retry reuses the same message
  // id/content and just flips its status back through sending → sent|failed
  // instead of appending a duplicate bubble.
  //
  // PERF: useCallback'd (dep on sendMessage alone, itself already stable —
  // see use-chat-stream.ts) so this keeps one identity across renders
  // instead of a fresh closure every time `draft` or `streamingText`
  // changes. Needed for handleRetry below to be stabilizable in turn,
  // which is what actually lets MessageBubble's memo() do anything.
  const deliver = useCallback(
    async (id: string, text: string) => {
      isNearBottomRef.current = true; // sending always snaps the view to it
      setHasNewBelow(false);
      const ok = await sendMessage(text, sessionCountRef.current);
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, status: ok ? "sent" : "failed" } : m))
      );
      if (ok) sessionCountRef.current += 1;
    },
    [sendMessage]
  );

  function handleSend() {
    const text = draft.trim();
    if (!text || isStreaming) return;

    const id = newId("user");
    setMessages((prev) => [...prev, { id, role: "user", content: text, status: "sending" }]);
    setDraft("");
    void deliver(id, text);
  }

  // PERF: useCallback'd so `onRetry` is a stable prop reference across
  // renders that don't touch `messages`/`isStreaming` — every
  // MessageBubble in the transcript receives this same function, so
  // without this every one of them would see a "changed" prop (by
  // reference) on every keystroke in the composer and re-render despite
  // being wrapped in memo(). Still recreated when `messages` itself
  // changes (new message arrives) since it needs the current list to
  // look up the retry target — that's an unavoidable, infrequent case
  // rather than the every-keystroke case this is actually fixing.
  const handleRetry = useCallback(
    (messageId: string) => {
      if (isStreaming) return;
      const target = messages.find((m) => m.id === messageId);
      if (!target) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, status: "sending" } : m))
      );
      void deliver(messageId, target.content);
    },
    [isStreaming, messages, deliver]
  );

  const upgradeCode =
    error?.code === "DAILY_LIMIT_EXCEEDED" ||
    error?.code === "PER_CHARACTER_LIMIT_EXCEEDED" ||
    error?.code === "PREMIUM_CHARACTER_REQUIRED" ||
    error?.code === "MATURE_CONTENT_GATE";

  // PAYWALL-EVERYWHERE: surface the shared upgrade modal the instant any
  // gated error comes back — chat limit/mature/locked-character codes
  // here, image/video generation codes below — instead of only offering a
  // small inline text link the user could miss or ignore.
  useEffect(() => {
    if (error?.code) {
      openPaywallForError(error.code, {
        usageStat:
          typeof error.used === "number" && typeof error.limit === "number"
            ? { used: error.used, limit: error.limit }
            : undefined,
      });
    }
  }, [error?.code, error?.used, error?.limit, openPaywallForError]);

  useEffect(() => {
    if (mediaError?.code) {
      // Image and video routes share the generic DAILY_LIMIT_EXCEEDED /
      // RATE_LIMIT_EXCEEDED codes, so mediaError.kind (set at the point of
      // failure in use-generate-media.ts) picks the right paywall copy —
      // relying on the code map alone here would show "message limit"
      // copy for a photo or video cap.
      const reasonOverride = mediaError.kind === "video" ? "videos" : "images";
      openPaywallForError(mediaError.code, { reasonOverride, usageStat: mediaError.usageStat });
    }
  }, [mediaError?.code, mediaError?.kind, mediaError?.usageStat, openPaywallForError]);

  return (
    // CHROME FIX: (app)/layout.tsx now hides TopBar/BottomNav for this
    // exact route (see its own isImmersiveChatRoute comment), so
    // ChatHeader (h-16, fixed) is the only chrome above this column at
    // any breakpoint — one number, no md: override needed. The bottom
    // safe-area inset is handled by the composer's own padding instead
    // of being subtracted here, so this column's box still ends exactly
    // at the true viewport edge (composer's background reaches all the
    // way down; only its *content* sits above the home-indicator strip).
    <div className="relative flex h-[calc(var(--vvh)-4rem)] flex-col">
      <MilestoneToastStack milestones={activeMilestones} onDismiss={dismissMilestone} />
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-5"
      >
        <div ref={contentRef} className="flex flex-col gap-4">
          {messages.length === 0 && !isStreaming && (
            <p className="text-center text-sm text-text-secondary py-8">
              Say hello to start the conversation.
            </p>
          )}
          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              role={m.role}
              content={m.content}
              imageUrl={m.imageUrl}
              videoUrl={m.videoUrl}
              characterId={characterId}
              messageId={m.id}
              status={m.status}
              onRetry={handleRetry}
              isPlaying={voicePlayingId === m.id}
              isLoadingVoice={voiceLoadingId === m.id}
              onPlayVoice={playVoice}
              onOpenMedia={setLightboxMedia}
            />
          ))}
          {isStreaming && streamingText && (
            <MessageBubble role="assistant" content={streamingText} />
          )}
          {isStreaming && !streamingText && (
            <div className="flex justify-start animate-fade-in">
              <div className="flex items-center gap-2 rounded-lg border border-border-hairline bg-base px-4 py-2.5">
                <span className="flex gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-text-tertiary animate-pulse" />
                  <span className="h-1.5 w-1.5 rounded-full bg-text-tertiary animate-pulse [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-text-tertiary animate-pulse [animation-delay:300ms]" />
                </span>
                {isQueued && (
                  <span className="text-xs text-text-tertiary">
                    High demand right now — this reply is queued and on its way.
                  </span>
                )}
              </div>
            </div>
          )}
          {error && (
            <div className="flex flex-col items-center gap-2 py-2">
              <p className="text-center text-sm text-danger">{error.message}</p>
              {(upgradeCode || error.canStillSwipe) && (
                <div className="flex items-center gap-3">
                  {upgradeCode && (
                    <Link
                      href="/premium"
                      className="text-xs font-semibold text-gold-400 hover:text-gold-300"
                    >
                      Upgrade
                    </Link>
                  )}
                  {error.canStillSwipe && (
                    <Link
                      href="/dating"
                      className="text-xs font-semibold text-gold-400 hover:text-gold-300"
                    >
                      Keep swiping
                    </Link>
                  )}
                </div>
              )}
            </div>
          )}
          {voiceError && (
            <button
              type="button"
              onClick={clearVoiceError}
              className="text-center text-sm text-danger py-2"
            >
              {voiceError} (dismiss)
            </button>
          )}
          {mediaError && (
            <button
              type="button"
              onClick={clearMediaError}
              className="text-center text-sm text-danger py-2"
            >
              {mediaError.message} (dismiss)
            </button>
          )}
        </div>
      </div>
      {!isNearBottom && hasNewBelow && (
        <button
          type="button"
          onClick={jumpToLatest}
          className="absolute bottom-24 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border-interactive bg-base px-3 py-1.5 text-xs font-medium text-text-primary shadow-card transition-colors ease-premium hover:border-gold-500/40"
        >
          <ArrowDown className="h-3 w-3" />
          New message
        </button>
      )}
      {lowQuota && (
        <p className="px-4 pb-1 text-center text-xs text-text-tertiary">
          {lowQuota.remaining === 0
            ? "You're out of messages with this character today."
            : `${lowQuota.remaining} message${lowQuota.remaining === 1 ? "" : "s"} left with this character today.`}{" "}
          <Link href="/premium" className="text-gold-400 hover:text-gold-300">
            Upgrade for unlimited
          </Link>
        </p>
      )}
      <ChatComposer
        value={draft}
        onChange={setDraft}
        onSend={handleSend}
        disabled={isStreaming}
        isStreaming={isStreaming}
        onStop={stop}
        onGenerateImage={handleGenerateImage}
        onGenerateVideo={handleGenerateVideo}
        isGeneratingImage={isGeneratingImage}
        isGeneratingVideo={isGeneratingVideo}
      />
      <MediaLightbox media={lightboxMedia} onClose={() => setLightboxMedia(null)} />
    </div>
  );
}

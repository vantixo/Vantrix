"use client";

import { memo, useMemo, useState } from "react";
import { SafeImage as Image } from "@/components/ui/safe-image";
import { Loader2, Volume2, Square, Play, Maximize2, RotateCcw, Sparkles, Gift } from "lucide-react";
import { cn, resolveImageSrc, resolveVideoSrc } from "@/lib/utils";
import { parseThoughtSegments } from "@/lib/chat/parse-thought-segments";
import type { LightboxMedia } from "./media-lightbox";

/**
 * §1 rule: "one background value, everywhere ... never a lighter fill."
 * Taken literally that rules out a tinted bubble fill for either role, so
 * user vs assistant is distinguished by alignment (the primary signal, and
 * the one that doesn't rely on color at all — relevant to §7 too) plus a
 * hairline-vs-gold-hairline border difference, exactly the "separation
 * without color shift" toolkit §1 hands us. Nothing here uses a gold fill;
 * gold stays reserved for actionable/premium elements per that section.
 *
 * VOICE-WIRE: play button only ever renders on assistant bubbles (a user
 * has no synthesized voice to play back) and only when a characterId is
 * supplied — the streaming preview bubble in chat-window.tsx renders
 * without one on purpose, since POST /api/voice/tts needs a stable
 * message to speak, not text that's still being appended to.
 *
 * SEND-STATE (this revision): a user bubble can carry `status`. Previously
 * a failed send left the message sitting in the thread indistinguishable
 * from a delivered one, with only a disconnected error line at the bottom
 * of the whole thread — nothing tied the failure to *which* message never
 * went through, and there was no way to retry short of retyping it.
 *
 * THOUGHT/ACTION PARSING (this revision): `content` was being rendered raw,
 * so a reply containing parse-thought-segments.ts's `[thought]`/`[action]`
 * markers (or bare `*action*` asides) showed the literal bracket/asterisk
 * text in the bubble instead of being parsed — the split already existed
 * for voice playback (use-voice-playback.ts strips thought/action before
 * TTS) but nothing did the equivalent for the visible bubble. Now routed
 * through the same shared parser: `speech` renders as plain text, `action`
 * renders inline-italic (always visible, reads as stage direction), and
 * `thought` renders as a tap-to-reveal chip per that file's documented
 * "peek-behind-the-curtain, not always-on narration" product decision.
 */
/**
 * PERF (runtime re-render pass): wrapped in memo() below — ChatWindow
 * renders one of these per message in the transcript, and previously had
 * no memoization at all, so every keystroke in the composer (`draft`
 * state), every streamed token (`streamingText`), and every voice-
 * playback state change re-rendered the *entire* message list, not just
 * the bubble that actually changed. All props here are either primitives
 * (role/content/imageUrl/...status/isPlaying/isLoadingVoice — cheap and
 * correct to shallow-compare) or already-stable function references
 * (onPlayVoice from use-voice-playback.ts's own useCallback, onOpenMedia
 * from a raw useState setter) — see chat-window.tsx for the matching
 * useCallback added around `handleRetry` so `onRetry` is stable too,
 * since a memo() child gains nothing if the parent hands it a brand-new
 * function identity on every render regardless of what changed.
 */
function MessageBubbleImpl({
  role,
  content,
  imageUrl,
  videoUrl,
  characterId,
  messageId,
  status,
  onRetry,
  isPlaying,
  isLoadingVoice,
  onPlayVoice,
  onOpenMedia,
}: {
  role: string;
  content: string;
  imageUrl?: string | null;
  videoUrl?: string | null;
  characterId?: string;
  messageId?: string;
  status?: "sending" | "sent" | "failed";
  onRetry?: (messageId: string) => void;
  isPlaying?: boolean;
  isLoadingVoice?: boolean;
  onPlayVoice?: (messageId: string, content: string, characterId: string) => void;
  onOpenMedia?: (media: LightboxMedia) => void;
}) {
  // HOOKS-ORDER FIX: these must run unconditionally on every render, before
  // the gift-role early return below — React Hooks can't be called after a
  // conditional return without breaking hook-call order between renders.
  // The gift-bubble path below doesn't need either value; that's fine, they
  // just go unused on that branch.
  // Segments recompute as `content` grows during streaming; the parser
  // itself handles an in-flight, not-yet-closed [thought]/[action] tag by
  // holding the partial text back rather than flashing raw markup.
  const segments = useMemo(() => parseThoughtSegments(content), [content]);
  const [revealedThoughts, setRevealedThoughts] = useState<Set<number>>(new Set());

  // GIFT-BUBBLE FIX: a `gift`-role row (see /api/dating/gifts's
  // GIFT-CHAT-FIX insert) was previously falling through to the default
  // rendering path with `isUser` false — chat-window.tsx's toLocal() used
  // to collapse any non-"user" role to "assistant", so "You sent a Bubble
  // Tea" rendered as a full-width, left-aligned *character* line: wrong
  // alignment (reads as her talking, not you), no gift affordance (no
  // icon, no visual distinction from a normal reply), and — because it's
  // sized like every other bubble — disproportionately large for what is
  // really just a compact system receipt. Gift rows now get their own
  // small centered pill, matching the "system event" treatment nothing
  // else in the transcript currently claims, so it can never be mistaken
  // for either party's actual dialogue. The character's *reaction* is a
  // separate, normal `assistant` row right after it (see the gift route),
  // so her acknowledgment still reads as her actually talking to you.
  if (role === "gift") {
    return (
      <div className="flex justify-center animate-fade-in py-1">
        <div className="flex max-w-[85%] items-center gap-1.5 rounded-full border border-gold-500/25 bg-gold-500/5 px-3 py-1 text-xs text-gold-400">
          <Gift className="h-3 w-3 shrink-0" />
          <span className="truncate">{content}</span>
        </div>
      </div>
    );
  }

  const isUser = role === "user";
  const canPlayVoice = !isUser && characterId && messageId && onPlayVoice;
  const isFailed = status === "failed";
  const isSending = status === "sending";

  function toggleThought(index: number) {
    setRevealedThoughts((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }
  // resolveImageSrc always returns *something* (a placeholder on a
  // missing/untrusted host) so it only runs when imageUrl exists — an
  // absent image shouldn't grow a placeholder thumbnail that wasn't there
  // before. resolveVideoSrc has no placeholder to substitute, so a
  // video on an untrusted host just quietly drops instead (see its doc
  // comment in lib/utils.ts).
  const safeImageUrl = imageUrl ? resolveImageSrc(imageUrl) : null;
  const safeVideoUrl = resolveVideoSrc(videoUrl);
  // Video takes priority when a message somehow carries both — same
  // "one piece of media per message" assumption the DB row already makes
  // (image_url / video_url are two separate nullable columns, not a union).
  const hasMedia = Boolean(safeVideoUrl || safeImageUrl);

  return (
    <div className={cn("flex flex-col animate-fade-in", isUser ? "items-end" : "items-start")}>
      <div
        className={cn(
          "flex",
          isUser ? "justify-end" : "justify-start",
          isSending && "opacity-60 transition-opacity ease-premium",
          isFailed && "opacity-80"
        )}
      >
        <div
          className={cn(
            "max-w-[78%] rounded-lg border bg-base px-4 py-2.5 text-[15px] leading-relaxed",
            isFailed
              ? "border-danger/40 text-text-primary"
              : isUser
              ? "border-gold-500/25 text-text-primary"
              : "border-border-hairline text-text-primary"
          )}
        >
          {hasMedia && (
            <button
              type="button"
              onClick={() =>
                onOpenMedia?.(
                  safeVideoUrl
                    ? { type: "video", url: safeVideoUrl }
                    : { type: "image", url: safeImageUrl as string }
                )
              }
              aria-label={safeVideoUrl ? "Play video" : "View image"}
              className={cn(
                "group relative mb-2 block w-full max-w-[220px] overflow-hidden rounded-md",
                // IMAGE-CROP FIX: this was a flat `aspect-square`, but chat
                // photos are never actually square — in-chat generation
                // defaults to Fal's `portrait_4_3` (3:4, see
                // lib/fal/lora-pipeline.ts's SceneGenerationInput), and
                // static character portraits on disk are ~2:3 (784x1168).
                // Squeezing either into a 1:1 box with object-cover crops
                // ~25-50% off the top and bottom combined — a real person's
                // photo rendered with the bottom half (or top half, or
                // both) missing. Generated video *is* genuinely square
                // (Kling's aspect_ratio is a hard '1:1' enum — see
                // animate-portrait.ts), so only the image branch changes;
                // matching the container to each media type's real aspect
                // ratio instead of one fixed shape for both.
                safeVideoUrl ? "aspect-square" : "aspect-[3/4]"
              )}
            >
              {safeVideoUrl ? (
                <video
                  src={safeVideoUrl}
                  muted
                  playsInline
                  preload="metadata"
                  className="h-full w-full object-cover"
                />
              ) : (
                <Image src={safeImageUrl as string} alt="" fill sizes="220px" className="object-cover" />
              )}
              <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors duration-150 ease-premium group-hover:bg-black/25">
                {safeVideoUrl ? (
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white transition-transform duration-150 ease-premium group-hover:scale-110">
                    <Play className="h-4 w-4 fill-current" />
                  </span>
                ) : (
                  <Maximize2 className="h-5 w-5 text-white opacity-0 transition-opacity duration-150 ease-premium group-hover:opacity-100" />
                )}
              </div>
            </button>
          )}
          <div className="flex items-start gap-2">
            <p className="whitespace-pre-wrap break-words flex-1">
              {segments.map((segment, i) => {
                const spacer = i > 0 ? " " : "";
                if (segment.type === "action") {
                  return (
                    <span key={i} className="italic text-text-tertiary">
                      {spacer}
                      {segment.text}
                    </span>
                  );
                }
                if (segment.type === "thought") {
                  const revealed = revealedThoughts.has(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => toggleThought(i)}
                      aria-pressed={revealed}
                      aria-label={revealed ? "Hide inner thought" : "Reveal inner thought"}
                      className={cn(
                        "mx-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 align-middle text-xs italic transition-colors ease-premium",
                        revealed
                          ? "border-gold-500/30 bg-gold-500/5 text-gold-300"
                          : "border-border-hairline text-text-tertiary hover:border-gold-500/40 hover:text-gold-400"
                      )}
                    >
                      <Sparkles className="h-3 w-3 shrink-0" />
                      {revealed ? segment.text : "inner thought"}
                    </button>
                  );
                }
                return (
                  <span key={i}>
                    {spacer}
                    {segment.text}
                  </span>
                );
              })}
            </p>
            {canPlayVoice && (
              <button
                type="button"
                onClick={() => onPlayVoice(messageId, content, characterId)}
                disabled={isLoadingVoice}
                aria-label={isPlaying ? "Stop voice message" : "Play voice message"}
                aria-pressed={isPlaying}
                className={cn(
                  "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors ease-premium",
                  "text-text-tertiary hover:text-gold-400 disabled:opacity-50",
                  isPlaying && "text-gold-400"
                )}
              >
                {isLoadingVoice ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : isPlaying ? (
                  <Square className="h-3 w-3 fill-current" />
                ) : (
                  <Volume2 className="h-3.5 w-3.5" />
                )}
              </button>
            )}
          </div>
        </div>
      </div>
      {isFailed && (
        <button
          type="button"
          onClick={() => messageId && onRetry?.(messageId)}
          className="mt-1 flex items-center gap-1 pr-1 text-xs text-danger transition-opacity ease-premium hover:opacity-80"
        >
          <RotateCcw className="h-3 w-3" />
          Failed to send — tap to retry
        </button>
      )}
    </div>
  );
}

export const MessageBubble = memo(MessageBubbleImpl);

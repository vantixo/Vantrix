"use client";

import { useEffect, useRef, useState } from "react";
import { SafeImage as Image } from "@/components/ui/safe-image";
import { useRouter } from "next/navigation";
import { ArrowLeft, BookOpen, Loader2, Square, Volume2, X } from "lucide-react";
import { cn, resolveImageSrc } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChoiceRail } from "@/components/roleplay/choice-rail";
import { ActionComposer } from "@/components/roleplay/action-composer";
import { useRoleplayTurn } from "@/hooks/use-roleplay-turn";
import { useVoicePlayback } from "@/hooks/use-voice-playback";
import { getSceneBackdrop } from "@/lib/roleplay/scene-backdrops";
import type { RoleplayChoice, RoleplayFeedItem, RoleplaySessionStatus } from "@/types/roleplay";

const ERROR_MESSAGES: Record<string, string> = {
  DAILY_CAP_REACHED: "You've reached today's message limit — come back tomorrow to continue.",
  RATE_LIMIT_EXCEEDED: "Slow down a little — try again in a moment.",
  SESSION_NOT_ACTIVE: "This story has already ended.",
};

interface LiveFeedItem extends RoleplayFeedItem {
  pending?: boolean;
}

export function RoleplayStage({
  sessionId,
  conversationId,
  scenarioTitle,
  scenarioSlug,
  backdropUrl,
  chapterCount,
  characterId,
  characterName,
  characterAvatar,
  initialFeed,
  initialChapter,
  initialStatus,
  initialChoices,
}: {
  sessionId: string;
  conversationId: string;
  scenarioTitle: string;
  /** roleplay_scenarios.slug — selects the CSS fallback backdrop when there's no cover art yet. See lib/roleplay/scene-backdrops.ts. */
  scenarioSlug: string;
  /** roleplay_scenarios.cover_image_url — real scene art, when an admin has set one. Takes priority over the CSS fallback. */
  backdropUrl: string | null;
  chapterCount: number;
  /** roleplay_sessions.character_id — threaded into POST /api/voice/tts for narration playback (see VOICE-WIRE note below). */
  characterId: string;
  characterName: string;
  characterAvatar: string | null;
  initialFeed: RoleplayFeedItem[];
  initialChapter: number;
  initialStatus: RoleplaySessionStatus;
  initialChoices: RoleplayChoice[] | null;
}) {
  const router = useRouter();
  const { sendTurn, endStory, isSending, isEnding, error, clearError } = useRoleplayTurn(sessionId);

  // VOICE-WIRE: same hook/contract chat-window.tsx already wires up for
  // normal chat (POST /api/voice/tts, text-cleanup.ts's own doc comment
  // notes it was already written with roleplay's *action*/quoted-dialogue
  // style narration in mind — this was the missing consumer, not a new
  // pipeline). One playback at a time across the whole feed, keyed by
  // feed item id exactly like chat's messageId.
  const {
    play: playVoice,
    playingId: voicePlayingId,
    loadingId: voiceLoadingId,
    error: voiceError,
    clearError: clearVoiceError,
  } = useVoicePlayback();

  const [feed, setFeed] = useState<LiveFeedItem[]>(initialFeed);
  const [chapter, setChapter] = useState(initialChapter);
  const [status, setStatus] = useState<RoleplaySessionStatus>(initialStatus);
  const [choices, setChoices] = useState<RoleplayChoice[] | null>(initialChoices);
  const [confirmEnd, setConfirmEnd] = useState(false);

  const feedEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [feed.length, isSending]);

  const isActive = status === "active";
  const backdrop = getSceneBackdrop(scenarioSlug);

  async function handleAction(actionType: "say" | "do" | "choice", text: string) {
    clearError();
    setChoices(null);

    const optimisticUser: LiveFeedItem = {
      id: `pending-user-${Date.now()}`,
      role: "user",
      content: actionType === "say" ? `"${text}"` : `*${text}*`,
      pending: true,
    };
    setFeed((prev) => [...prev, optimisticUser]);

    const result = await sendTurn(actionType, text);
    if (!result) {
      // Leave the optimistic entry — the user's words shouldn't vanish on
      // failure, and the error banner (from the hook) explains what happened.
      return;
    }

    setFeed((prev) => [
      ...prev.filter((item) => item.id !== optimisticUser.id),
      { ...optimisticUser, id: `user-${result.beatNumber}`, pending: false },
      {
        id: `assistant-${result.beatNumber}`,
        role: "assistant",
        content: result.narrative,
        chapter: result.chapter,
        beatType: result.isChapterEnd ? "chapter_end" : "narration",
        choices: result.choices,
      },
    ]);
    setChapter(result.chapter);
    setStatus(result.status);
    setChoices(result.choices);
  }

  async function handleEnd() {
    const ok = await endStory();
    if (ok) router.push(`/chat/${conversationId}`);
  }

  return (
    <div className="relative flex h-[var(--vvh)] flex-col bg-base">
      {/* Backdrop — real cover art when a scenario has one (see the
          scenarioSlug/backdropUrl prop docs above), otherwise a per-location
          CSS gradient so a scene never renders visually flat. Fixed behind
          everything, scrimmed underneath the feed for text legibility. */}
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden>
        {backdropUrl ? (
          <Image src={resolveImageSrc(backdropUrl)} alt="" fill priority sizes="100vw" className="object-cover opacity-40" />
        ) : (
          <div className={`absolute inset-0 ${backdrop.gradient}`} />
        )}
        <div className={`absolute inset-0 ${backdrop.glow}`} />
        <div className="absolute inset-0 bg-black/35" />
      </div>

      {/* Header — CHAT-PARITY PASS: rebuilt to mirror chat-header.tsx's
          own chrome bar (h-16, font-display title, same avatar sizing)
          so Story Mode reads as the same premium surface as a regular
          conversation instead of a visually distinct "mode" bolted on
          top of it. */}
      <div className="relative z-10 flex h-16 shrink-0 items-center gap-3 border-b border-border-hairline bg-base/60 px-4 backdrop-blur-md">
        <button
          onClick={() => router.push(`/chat/${conversationId}`)}
          aria-label="Back to chat"
          className="text-text-secondary transition-colors ease-premium hover:text-text-primary"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>

        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full border border-border-hairline bg-black/40">
          {characterAvatar ? (
            <Image src={resolveImageSrc(characterAvatar)} alt={characterName} fill sizes="40px" className="object-cover" />
          ) : (
            <BookOpen className="absolute inset-0 m-auto h-4 w-4 text-gold-500/50" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[15px] text-text-primary">{scenarioTitle}</p>
          <p className="truncate text-xs text-text-secondary">with {characterName}</p>
        </div>

        <Badge variant={status === "completed" ? "solid" : "outline"}>
          {status === "completed" ? "Complete" : `Ch. ${chapter}/${chapterCount}`}
        </Badge>

        {isActive && (
          <button
            onClick={() => setConfirmEnd(true)}
            aria-label="End story"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-text-tertiary transition-colors ease-premium hover:bg-danger/10 hover:text-danger"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Chapter progress — a small premium touch chat doesn't need (a
          conversation has no fixed length) but a multi-chapter story
          does: a persistent sense of "how far in" the current story is,
          without needing to scroll back to the last divider. */}
      {chapterCount > 0 && (
        <div className="relative z-10 h-0.5 w-full bg-white/5">
          <div
            className="h-full bg-gold-fill transition-all duration-500 ease-premium"
            style={{ width: `${Math.min(100, (chapter / chapterCount) * 100)}%` }}
          />
        </div>
      )}

      {/* Feed */}
      <div className="relative z-10 min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto flex max-w-xl flex-col gap-5">
          {feed.map((item, idx) => {
            const showChapterDivider =
              item.role === "assistant" &&
              item.chapter !== undefined &&
              (idx === 0 || feed[idx - 1]?.chapter !== item.chapter);

            return (
              <div key={item.id}>
                {showChapterDivider && (
                  <div className="mb-5 mt-1 flex items-center gap-3">
                    <div className="h-px flex-1 bg-gradient-to-r from-transparent to-gold-500/25" />
                    <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-gold-500/30 bg-black/40 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-gold-400 backdrop-blur-sm">
                      <BookOpen className="h-3 w-3" />
                      Chapter {item.chapter}
                    </span>
                    <div className="h-px flex-1 bg-gradient-to-l from-transparent to-gold-500/25" />
                  </div>
                )}

                {item.role === "user" ? (
                  // CHAT-PARITY: a plain right-aligned line of text before —
                  // now a bordered, shadowed bubble matching message-
                  // bubble.tsx's user treatment (rounded-lg, gold-500/25
                  // border, bg-base) so your own turns look like a
                  // message you sent, not a caption under someone else's.
                  <div
                    className={cn(
                      "flex justify-end animate-fade-in",
                      item.pending && "opacity-60 transition-opacity ease-premium",
                    )}
                  >
                    <div className="max-w-[85%] rounded-lg border border-gold-500/25 bg-base/80 px-4 py-2.5 text-[15px] leading-relaxed text-gold-200 shadow-card backdrop-blur-sm">
                      {item.content}
                    </div>
                  </div>
                ) : (
                  // The gold rule + serif type is Story Mode's own
                  // identity (a narrated page reads differently than a
                  // chat reply, deliberately) — but it now sits inside a
                  // defined card (shadow-card, hairline-adjacent bg-base/40
                  // fill) instead of floating as bare text, so it carries
                  // the same sense of "premium surface" as a chat bubble
                  // without losing that literary framing.
                  <div className="group relative animate-fade-in rounded-r-lg border-l-2 border-gold-500/30 bg-base/40 py-3 pl-4 pr-3 shadow-card backdrop-blur-sm">
                    <div className="flex items-start gap-2">
                      <p className="flex-1 whitespace-pre-wrap font-serif text-[15px] leading-relaxed text-text-primary">
                        {item.content}
                      </p>
                      <button
                        type="button"
                        onClick={() => playVoice(item.id, item.content, characterId)}
                        disabled={voiceLoadingId === item.id}
                        aria-label={voicePlayingId === item.id ? "Stop narration" : "Play narration"}
                        aria-pressed={voicePlayingId === item.id}
                        className={cn(
                          "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors ease-premium",
                          "text-text-tertiary hover:text-gold-400 disabled:opacity-50",
                          voicePlayingId === item.id && "text-gold-400"
                        )}
                      >
                        {voiceLoadingId === item.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : voicePlayingId === item.id ? (
                          <Square className="h-3 w-3 fill-current" />
                        ) : (
                          <Volume2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* CHAT-PARITY: chat-window.tsx shows a dot-bounce bubble while
              a reply streams in; Story Mode previously gave no feedback
              at all between sending a turn and the next beat landing —
              the composer's own spinner was the only cue, easy to miss
              once your eyes are back up in the feed. */}
          {isSending && (
            <div className="flex animate-fade-in items-center gap-2 rounded-r-lg border-l-2 border-gold-500/30 bg-base/40 px-4 py-3 shadow-card backdrop-blur-sm">
              <span className="flex gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-gold-500/60 animate-pulse" />
                <span className="h-1.5 w-1.5 rounded-full bg-gold-500/60 animate-pulse [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 rounded-full bg-gold-500/60 animate-pulse [animation-delay:300ms]" />
              </span>
              <span className="font-serif text-xs italic text-text-tertiary">The story continues…</span>
            </div>
          )}

          <div ref={feedEndRef} />
        </div>
      </div>

      {/* Choices / composer / end states */}
      <div className="relative z-10 mx-auto w-full max-w-xl px-4">
        {error && (
          <p className="mb-2 rounded-sm border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {ERROR_MESSAGES[error.code ?? ""] ?? error.error}
          </p>
        )}

        {voiceError && (
          <button
            type="button"
            onClick={clearVoiceError}
            className="mb-2 w-full rounded-sm border border-danger/30 bg-danger/10 px-3 py-2 text-center text-sm text-danger"
          >
            {voiceError} (dismiss)
          </button>
        )}

        {isActive && choices && choices.length > 0 && (
          <div className="mb-3">
            <ChoiceRail
              choices={choices}
              disabled={isSending}
              onPick={(choice) => handleAction("choice", choice.label)}
            />
          </div>
        )}
      </div>

      {status === "completed" && (
        <div className="relative z-10 border-t border-border-hairline bg-base/70 px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-6 text-center backdrop-blur-md">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full border border-gold-500/30 bg-gold-500/5">
            <BookOpen className="h-5 w-5 text-gold-400" />
          </div>
          <p className="mb-1 font-display text-base text-text-primary">The story has ended.</p>
          <p className="mb-4 text-sm text-text-tertiary">
            You can keep chatting with {characterName} normally, or begin a new story anytime.
          </p>
          <div className="flex justify-center gap-2">
            <Button variant="secondary" onClick={() => router.push(`/chat/${conversationId}`)}>
              Back to Chat
            </Button>
          </div>
        </div>
      )}

      {status === "abandoned" && (
        <div className="relative z-10 border-t border-border-hairline bg-base/70 px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-5 text-center text-sm text-text-tertiary backdrop-blur-md">
          This story was ended early.
        </div>
      )}

      {isActive && (
        <div className="relative z-10">
          <ActionComposer
            onSend={handleAction}
            disabled={isSending}
            isSending={isSending}
          />
        </div>
      )}

      {/* End-story confirmation */}
      {confirmEnd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-lg border border-border-hairline bg-base p-5 shadow-card">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-danger/30 bg-danger/5">
              <X className="h-4 w-4 text-danger" />
            </div>
            <p className="mb-1 text-sm font-semibold text-text-primary">End this story?</p>
            <p className="mb-4 text-sm text-text-tertiary">
              You&apos;ll stop mid-chapter and lose the thread — everything said so far stays in your chat history with {characterName}.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmEnd(false)} disabled={isEnding}>
                Keep going
              </Button>
              <Button variant="destructive" size="sm" onClick={handleEnd} disabled={isEnding}>
                {isEnding ? <Loader2 className="h-4 w-4 animate-spin" /> : "End story"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

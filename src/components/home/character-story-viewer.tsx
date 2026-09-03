"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SafeImage as Image } from "@/components/ui/safe-image";
import { X } from "lucide-react";
import { resolveImageSrc, resolveVideoSrc } from "@/lib/utils";
import type { DiscoverAvatar } from "@/lib/frontend/discover";

interface StoryItem {
  type: "image" | "video";
  url: string;
}

const IMAGE_DURATION_MS = 5000;
const TICK_MS = 50;
const SWIPE_THRESHOLD_PX = 60;
const TAP_MAX_MS = 300;

function buildItems(a: DiscoverAvatar): StoryItem[] {
  const items: StoryItem[] = [];
  if (a.image) items.push({ type: "image", url: a.image });
  if (a.introVideoUrl) items.push({ type: "video", url: a.introVideoUrl });
  for (const url of a.galleryImageUrls ?? []) items.push({ type: "image", url });
  for (const url of a.galleryVideoUrls ?? []) items.push({ type: "video", url });
  return items;
}

/**
 * Full-screen story viewer opened by CharacterStatusRing — one segmented
 * progress bar per item, auto-advancing (fixed duration for images, the
 * video's own playback for video items), with tap-left/right to step and
 * a horizontal swipe to jump characters entirely. Holding anywhere pauses
 * the active segment, same as the platform convention this mirrors.
 *
 * Deliberately a separate component from MediaLightbox (chat/media-
 * lightbox.tsx), which is a single-item, no-timer viewer reused across
 * every chat MessageBubble — bolting multi-item/timer/progress-bar
 * behavior onto that would change what every one of those call sites
 * renders. IG/WhatsApp keep an analogous split (a status viewer and a
 * single-photo viewer are different surfaces); this does the same.
 */
export function CharacterStoryViewer({
  avatars,
  startIndex,
  onSeen,
  onClose,
}: {
  avatars: DiscoverAvatar[];
  startIndex: number;
  onSeen: (characterId: string) => void;
  onClose: () => void;
}) {
  const [charIndex, setCharIndex] = useState(startIndex);
  const [itemIndex, setItemIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0); // 0-100, active item only
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const touchStartX = useRef<number | null>(null);
  const pauseStartRef = useRef<number | null>(null);

  const character = avatars[charIndex] as DiscoverAvatar | undefined;
  const items = character ? buildItems(character) : [];
  const item = items[itemIndex];
  const safeImageUrl = item?.type === "image" ? resolveImageSrc(item.url) : null;
  const safeVideoUrl = item?.type === "video" ? resolveVideoSrc(item.url) : null;

  const advance = useCallback(
    (dir: 1 | -1) => {
      if (!character) return;
      if (dir === 1 && itemIndex >= items.length - 1) {
        // Last item of the last character closes instead of looping —
        // matches the "status stack" convention this mirrors.
        if (charIndex >= avatars.length - 1) onClose();
        else setCharIndex((c) => c + 1);
        return;
      }
      if (dir === -1 && itemIndex <= 0) {
        if (charIndex > 0) setCharIndex((c) => c - 1);
        return;
      }
      setItemIndex((i) => i + dir);
    },
    [character, itemIndex, items.length, charIndex, avatars.length, onClose]
  );

  // Every character change starts at their first item.
  useEffect(() => {
    setItemIndex(0);
    setProgress(0);
  }, [charIndex]);

  // Item changes (within the same character) also reset the bar.
  useEffect(() => {
    setProgress(0);
  }, [itemIndex]);

  // Mark seen the moment a character's story opens — WhatsApp dims the
  // ring on first view, not only after the whole story finishes.
  useEffect(() => {
    if (character) onSeen(character.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character?.id]);

  // Body-scroll lock + Escape-to-close while the overlay is mounted.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") advance(1);
      if (e.key === "ArrowLeft") advance(-1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  // Auto-advance timer for image items. Deliberately reads `progress`
  // once at effect-creation time (not as a dependency) to resume from
  // wherever the bar was frozen when `paused` last flipped true, rather
  // than restarting the segment from zero on every tick.
  useEffect(() => {
    if (!item || item.type !== "image" || paused) return;
    const start = Date.now() - (progress / 100) * IMAGE_DURATION_MS;
    const id = setInterval(() => {
      const pct = Math.min(100, ((Date.now() - start) / IMAGE_DURATION_MS) * 100);
      setProgress(pct);
      if (pct >= 100) advance(1);
    }, TICK_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, paused, itemIndex, charIndex]);

  // Video items play/pause in step with `paused`; progress + advance are
  // driven by the video element itself (onTimeUpdate / onEnded below),
  // not this timer.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || item?.type !== "video") return;
    if (paused) v.pause();
    else v.play().catch(() => {});
  }, [paused, item]);

  function handlePointerDown(e: React.PointerEvent) {
    pauseStartRef.current = Date.now();
    touchStartX.current = e.clientX;
    setPaused(true);
  }

  function handlePointerUp(e: React.PointerEvent) {
    const dx = e.clientX - (touchStartX.current ?? e.clientX);
    const heldMs = Date.now() - (pauseStartRef.current ?? Date.now());
    touchStartX.current = null;
    setPaused(false);

    if (Math.abs(dx) > SWIPE_THRESHOLD_PX) {
      if (dx < 0 && charIndex < avatars.length - 1) setCharIndex((c) => c + 1);
      else if (dx > 0 && charIndex > 0) setCharIndex((c) => c - 1);
      return;
    }
    if (heldMs <= TAP_MAX_MS) {
      const isRightHalf = e.clientX > window.innerWidth / 2;
      advance(isRightHalf ? 1 : -1);
    }
  }

  if (!character || !item) return null;

  return (
    <div
      className="fixed inset-0 z-50 select-none bg-black"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => setPaused(false)}
      role="dialog"
      aria-modal="true"
      aria-label={`${character.name}'s story`}
    >
      <div className="absolute inset-x-0 top-0 z-10 flex gap-1 px-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        {items.map((_, i) => (
          <div key={i} className="h-[2px] flex-1 overflow-hidden rounded-full bg-white/25">
            <div
              className="h-full bg-white"
              style={{ width: `${i < itemIndex ? 100 : i === itemIndex ? progress : 0}%` }}
            />
          </div>
        ))}
      </div>

      <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-2 px-3 pt-[max(1.75rem,calc(env(safe-area-inset-top)+1.25rem))]">
        <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full border border-white/20">
          <Image
            src={resolveImageSrc(character.image)}
            alt={character.name}
            fill
            sizes="32px"
            className="object-cover"
          />
        </div>
        <span className="truncate text-sm font-semibold text-white">{character.name}</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          aria-label="Close"
          className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex h-full w-full items-center justify-center">
        {safeVideoUrl ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption -- generated
          // character clips have no caption track to attach (matches
          // MediaLightbox's same allowance).
          <video
            key={safeVideoUrl}
            ref={videoRef}
            src={safeVideoUrl}
            autoPlay
            playsInline
            className="max-h-full max-w-full object-contain"
            onTimeUpdate={(e) => {
              const v = e.currentTarget;
              if (v.duration) setProgress((v.currentTime / v.duration) * 100);
            }}
            onEnded={() => advance(1)}
          />
        ) : safeImageUrl ? (
          <div className="relative h-full w-full">
            <Image
              src={safeImageUrl}
              alt=""
              fill
              sizes="100vw"
              className="object-contain"
              priority
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

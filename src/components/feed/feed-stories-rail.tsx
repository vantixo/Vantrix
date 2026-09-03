"use client";

import { useState } from "react";
import { SafeImage as Image } from "@/components/ui/safe-image";
import { resolveImageSrc, cn } from "@/lib/utils";
import { CharacterStoryViewer } from "@/components/home/character-story-viewer";
import type { FeedCharacterSummary } from "@/types/feed";
import type { DiscoverAvatar } from "@/lib/frontend/discover";

const SEEN_KEY_PREFIX = "vantrix:seenStatus:";

/** Same gate as CharacterStatusRing's hasStoryContent, minus the bare-image
 *  case — every feed character has image_url (it's their post thumbnail),
 *  so including it here would make every avatar "have a story" and the
 *  existing tap-to-filter behavior would never fire again. Gating on real
 *  story media (video/gallery) instead means characters without any get
 *  the old filter behavior; characters with some get the story viewer. */
function hasStoryMedia(c: FeedCharacterSummary): boolean {
  return Boolean(
    c.intro_video_url || c.gallery_image_urls?.length || c.gallery_video_urls?.length
  );
}

function toDiscoverAvatar(c: FeedCharacterSummary): DiscoverAvatar {
  return {
    id: c.id,
    name: c.name,
    image: c.image_url,
    isNew: false,
    isLive: !!c.is_live,
    videoUrl: null,
    introVideoUrl: c.intro_video_url,
    galleryImageUrls: c.gallery_image_urls,
    galleryVideoUrls: c.gallery_video_urls,
  };
}

/**
 * IG-style stories rail — the feed's one signature flourish. Rather than a
 * new "who's active" backend endpoint, this derives its list from the
 * characters already present in the loaded posts (FeedGrid dedupes and
 * passes them in): whoever has posted recently is, by definition, a
 * companion worth surfacing here. No extra query, no extra route.
 *
 * The gold ring (vs. Instagram's rainbow gradient) reuses `bg-gold-fill` —
 * the same token the rest of the app already reserves for "interactive or
 * premium" surfaces — so an avatar ring reads as on-brand rather than a
 * borrowed convention. A live companion gets the ring.
 *
 * Tapping a companion with real story media (intro video / gallery —
 * see hasStoryMedia) opens the same full-screen CharacterStoryViewer Home's
 * CharacterStatusRing uses, showing their videos and images. Tapping one
 * without story media falls back to the original behavior: filter the feed
 * to just their posts. "All" always resets the filter.
 */
export function FeedStoriesRail({
  characters,
  activeId,
  onSelect,
}: {
  characters: FeedCharacterSummary[];
  activeId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const storyAvatars = characters.filter(hasStoryMedia).map(toDiscoverAvatar);

  if (characters.length === 0) return null;

  function handleAvatarClick(c: FeedCharacterSummary) {
    if (hasStoryMedia(c)) {
      const idx = storyAvatars.findIndex((a) => a.id === c.id);
      if (idx !== -1) setOpenIndex(idx);
      return;
    }
    onSelect(activeId === c.id ? null : c.id);
  }

  function markSeen(id: string) {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SEEN_KEY_PREFIX + id, "1");
    }
    // Fire-and-forget, same endpoint CharacterStatusRing uses — keeps
    // "seen" state consistent whether a companion's status was viewed from
    // Home or from the feed. A signed-out 401 here is fine, nothing to
    // persist server-side for that case anyway.
    fetch("/api/discover/status-views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ characterId: id }),
    }).catch(() => {});
  }

  return (
    <>
      <div className="flex gap-4 overflow-x-auto no-scrollbar px-4 md:px-0 py-3">
        <StoryAvatar
          label="All"
          active={activeId === null}
          onClick={() => onSelect(null)}
        />
        {characters.map((c) => (
          <StoryAvatar
            key={c.id}
            label={c.name}
            imageUrl={c.image_url}
            ringed={!!c.is_live || hasStoryMedia(c)}
            active={activeId === c.id}
            onClick={() => handleAvatarClick(c)}
          />
        ))}
      </div>

      {openIndex !== null && (
        <CharacterStoryViewer
          avatars={storyAvatars}
          startIndex={openIndex}
          onSeen={markSeen}
          onClose={() => setOpenIndex(null)}
        />
      )}
    </>
  );
}

function StoryAvatar({
  label,
  imageUrl,
  ringed = false,
  active,
  onClick,
}: {
  label: string;
  imageUrl?: string | null;
  ringed?: boolean;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 shrink-0 w-16 group"
    >
      <span
        className={cn(
          "relative h-16 w-16 rounded-full p-[2px] transition-transform duration-150 ease-premium group-active:scale-95",
          ringed || active ? "bg-gold-fill" : "bg-white/10"
        )}
      >
        <span className="flex h-full w-full items-center justify-center rounded-full bg-base p-[2px]">
          {imageUrl === undefined ? (
            <span className="flex h-full w-full items-center justify-center rounded-full bg-white/[0.04] font-display text-sm text-gold-400">
              {label.slice(0, 1).toUpperCase()}
            </span>
          ) : (
            <span className="relative h-full w-full overflow-hidden rounded-full">
              <Image
                src={resolveImageSrc(imageUrl)}
                alt={label}
                fill
                sizes="64px"
                className="object-cover"
              />
            </span>
          )}
        </span>
      </span>
      <span
        className={cn(
          "text-[11px] max-w-[64px] truncate",
          active ? "text-gold-400 font-medium" : "text-text-tertiary"
        )}
      >
        {label}
      </span>
    </button>
  );
}

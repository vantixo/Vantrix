"use client";

import { useEffect, useState } from "react";
import { SafeImage as Image } from "@/components/ui/safe-image";
import { cn, resolveImageSrc } from "@/lib/utils";
import { CharacterStoryViewer } from "./character-story-viewer";
import type { DiscoverAvatar } from "@/lib/frontend/discover";

const SEEN_KEY_PREFIX = "vantrix:seenStatus:";

function readLocalSeen(ids: string[]): Set<string> {
  if (typeof window === "undefined") return new Set();
  const seen = new Set<string>();
  for (const id of ids) {
    if (window.localStorage.getItem(SEEN_KEY_PREFIX + id)) seen.add(id);
  }
  return seen;
}

/**
 * Pulls the signed-in user's server-known seen set (GET
 * /api/discover/status-views — see 20261032_character_status_views.sql)
 * so the ring reflects views from another device/browser, not just this
 * one. Fails soft to an empty set: a signed-out visitor gets `[]` from
 * the route itself (not a 401), and a network error here just leaves the
 * localStorage-derived state as-is rather than surfacing an error for
 * what's a cosmetic ring color.
 */
async function fetchServerSeen(): Promise<string[]> {
  try {
    const res = await fetch("/api/discover/status-views");
    const body = await res.json().catch(() => null);
    return Array.isArray(body?.viewedCharacterIds) ? body.viewedCharacterIds : [];
  } catch {
    return [];
  }
}

function hasStoryContent(a: DiscoverAvatar): boolean {
  return Boolean(
    a.image || a.introVideoUrl || a.galleryImageUrls?.length || a.galleryVideoUrls?.length
  );
}

/**
 * WhatsApp-status-style avatar strip. `/api/discover/featured` has always
 * shipped an `avatars` array — image/introVideoUrl/galleryImageUrls/
 * galleryVideoUrls per character — built specifically to feed this ring +
 * a full-screen story viewer, but no component ever consumed it and
 * DiscoverHomeData dropped the field before it reached a page. This is
 * that missing consumer.
 *
 * Ring color is the only seen/unseen signal — gold for unseen, the
 * standard hairline border once viewed — matching the "gold is a meaning
 * color, reserved for interactive/premium surfaces" rule in
 * tailwind.config.ts rather than introducing a second accent treatment.
 *
 * Seen state is localStorage-first (instant, works signed-out) and then
 * reconciled with the server's character_status_views table on mount for
 * a signed-in user, so the ring is correct immediately and stays correct
 * across devices once the network round trip lands.
 */
export function CharacterStatusRing({ avatars }: { avatars: DiscoverAvatar[] }) {
  const withStory = avatars.filter(hasStoryContent);
  const ids = withStory.map((a) => a.id).join(",");
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const idList = ids ? ids.split(",") : [];
    setSeen(readLocalSeen(idList));

    fetchServerSeen().then((serverIds) => {
      if (cancelled || serverIds.length === 0) return;
      setSeen((prev) => {
        const next = new Set(prev);
        for (const id of serverIds) next.add(id);
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [ids]);

  function markSeen(id: string) {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SEEN_KEY_PREFIX + id, "1");
    }
    setSeen((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));

    // Fire-and-forget: localStorage above already made the ring correct
    // for this browser. A signed-out user gets a 401 here and that's
    // fine — nothing to persist server-side for them anyway.
    fetch("/api/discover/status-views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ characterId: id }),
    }).catch(() => {});
  }

  if (withStory.length === 0) return null;

  return (
    <>
      <section className="px-4 md:px-8 pt-2 pb-4">
        <div className="max-w-7xl mx-auto flex gap-4 overflow-x-auto no-scrollbar">
          {withStory.map((a, i) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setOpenIndex(i)}
              className="flex flex-col items-center gap-1.5 shrink-0"
            >
              <div
                className={cn(
                  "relative h-16 w-16 overflow-hidden rounded-full border-2 transition-colors ease-premium",
                  seen.has(a.id) ? "border-border-hairline" : "border-gold-500"
                )}
              >
                <Image
                  src={resolveImageSrc(a.image)}
                  alt={a.name}
                  fill
                  sizes="64px"
                  className="object-cover"
                />
              </div>
              <span className="max-w-[68px] truncate text-xs text-text-secondary">
                {a.name}
              </span>
            </button>
          ))}
        </div>
      </section>

      {openIndex !== null && (
        <CharacterStoryViewer
          avatars={withStory}
          startIndex={openIndex}
          onSeen={markSeen}
          onClose={() => setOpenIndex(null)}
        />
      )}
    </>
  );
}

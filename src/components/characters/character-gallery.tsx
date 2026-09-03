"use client";

import { useState } from "react";
import Image from "next/image";
import { Images, Play } from "lucide-react";
import { CHARACTER_IMAGE_FALLBACK, resolveImageSrc, resolveVideoSrc } from "@/lib/utils";
import { MediaLightbox, type LightboxMedia } from "@/components/chat/media-lightbox";

/**
 * GALLERY-WIRE: characters.intro_video_url / gallery_image_urls /
 * gallery_video_urls have been in the schema since 20260717_character_
 * media_gallery.sql and populated since the 20260725/20260726 backfills,
 * but no page ever rendered them — the character detail page only ever
 * showed the single primary image_url. This is that render, added as a
 * third "Gallery" tab alongside World Profile / Our Story.
 *
 * Reuses MediaLightbox (previously owned solely by ChatWindow) for the
 * full-screen viewer rather than building a second one, and matches
 * MessageBubble's own thumbnail treatment (muted/playsInline/preload=
 * metadata <video> for a frame-as-poster, dark overlay + Play glyph) so a
 * video tile in the gallery looks like the same primitive a video tile in
 * chat does.
 *
 * Purely presentational — all three arrays already went through
 * resolveImageSrc-style host validation for reference_images at the admin
 * upload step (see /api/admin/characters/[id]/media), but this
 * re-validates at render time too, same two-layer habit as everywhere
 * else in the app that renders a DB-sourced URL.
 */

interface GalleryItem {
  type: "image" | "video";
  url: string;
}

/**
 * IMAGES-NOT-RENDERING FIX: resolveImageSrc only validates *hostname*
 * (allowlisted remote host, or a same-origin "/" path) — it has no way to
 * know whether a same-origin path 404s (wrong filename, file never
 * uploaded, deleted asset, etc.), since that's a real network request the
 * browser hasn't made yet. Without this, a stale/typo'd gallery_image_urls
 * entry rendered as a raw broken-image icon instead of the shared
 * placeholder this component's own comment above already promises. Each
 * tile gets its own error state so one bad image doesn't affect its
 * siblings, and doesn't retry the same broken URL after swapping.
 */
function GalleryImageTile({ src, alt, className }: { src: string; alt: string; className: string }) {
  const [errored, setErrored] = useState(false);
  return (
    <Image
      src={errored ? CHARACTER_IMAGE_FALLBACK : src}
      alt={alt}
      fill
      sizes="(max-width: 640px) 33vw, 220px"
      className={className}
      onError={() => setErrored(true)}
    />
  );
}

export function CharacterGallery({
  characterName,
  introVideoUrl,
  galleryImageUrls,
  galleryVideoUrls,
}: {
  characterName: string;
  introVideoUrl?: string | null;
  galleryImageUrls?: string[];
  galleryVideoUrls?: string[];
}) {
  const [active, setActive] = useState<LightboxMedia | null>(null);

  const videoUrls = [
    ...(introVideoUrl ? [introVideoUrl] : []),
    ...(galleryVideoUrls ?? []),
  ].filter((url, i, arr) => arr.indexOf(url) === i); // dedupe intro clip if it's also listed in gallery_video_urls

  const items: GalleryItem[] = [
    ...videoUrls.map((url) => ({ type: "video" as const, url })),
    ...(galleryImageUrls ?? []).map((url) => ({ type: "image" as const, url })),
  ]
    // Drop anything that fails host validation rather than rendering a
    // broken tile — same "omit, don't substitute" contract resolveVideoSrc
    // documents for video; images fall back to the shared placeholder
    // instead of being dropped, so a bad image URL still occupies its
    // grid slot rather than silently vanishing.
    .filter((item) => (item.type === "video" ? Boolean(resolveVideoSrc(item.url)) : true));

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <Images className="h-8 w-8 text-text-tertiary" />
        <p className="text-sm text-text-secondary">
          No gallery media yet for {characterName}.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
        {items.map((item, i) => (
          <button
            key={`${item.type}-${item.url}-${i}`}
            type="button"
            onClick={() => setActive(item)}
            aria-label={item.type === "video" ? "Play video" : "View image"}
            className="group relative aspect-square overflow-hidden rounded-sm border border-border-hairline"
          >
            {item.type === "video" ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption -- generated character clips have no caption track.
              <video
                src={item.url}
                muted
                playsInline
                preload="metadata"
                className="h-full w-full object-cover"
              />
            ) : (
              <GalleryImageTile
                src={resolveImageSrc(item.url)}
                alt={`${characterName} gallery photo ${i + 1}`}
                className="object-cover transition-transform duration-150 ease-premium group-hover:scale-105"
              />
            )}
            <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors duration-150 ease-premium group-hover:bg-black/20">
              {item.type === "video" && (
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white transition-transform duration-150 ease-premium group-hover:scale-110">
                  <Play className="h-3.5 w-3.5 fill-current" />
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
      <MediaLightbox media={active} onClose={() => setActive(null)} />
    </>
  );
}

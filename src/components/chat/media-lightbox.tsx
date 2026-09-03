"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { SafeImage as Image } from "@/components/ui/safe-image";
import { X } from "lucide-react";
import { resolveImageSrc, resolveVideoSrc } from "@/lib/utils";

export interface LightboxMedia {
  type: "image" | "video";
  url: string;
}

/**
 * Full-screen viewer opened from a MessageBubble thumbnail. Kept as a
 * single instance owned by ChatWindow (not one per bubble) so only one
 * overlay ever exists in the DOM regardless of how many messages carry
 * media — see chat-window.tsx.
 *
 * Re-validates the host here too (not just at the MessageBubble thumbnail
 * that opened it) via resolveImageSrc/resolveVideoSrc — same two-layer
 * habit the rest of the app uses for image_url (checked both where data is
 * written and again at every render call site), so this component is safe
 * to render standalone rather than trusting whatever a caller passes in.
 *
 * Video uses a plain <video> (native controls, autoplay on open) since
 * next/image has no video equivalent. Image reuses next/image inside a
 * viewport-relative box + object-contain, matching the object-cover
 * treatment MessageBubble's own thumbnail already uses.
 *
 * MOBILE-EXPAND-FIX: rendered via createPortal(..., document.body). Any
 * caller nested under an element with backdrop-filter/filter (e.g.
 * ChatHeader's `backdrop-blur`, via CharacterGallery -> ChatHeaderAvatar)
 * would otherwise have this `fixed inset-0` boxed into that ancestor
 * instead of the viewport on iOS/Android Safari — see chat-header-avatar.
 * tsx's own MOBILE-EXPAND-FIX comment for the full mechanism.
 */
export function MediaLightbox({
  media,
  onClose,
}: {
  media: LightboxMedia | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!media) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [media, onClose]);

  if (!media) return null;

  const safeVideoUrl = media.type === "video" ? resolveVideoSrc(media.url) : null;
  // An untrusted-host video has nothing safe to fall back to (unlike the
  // image path below) — closing rather than rendering a broken/unvetted
  // <video src> is the "omit" half of resolveVideoSrc's degrade contract.
  if (media.type === "video" && !safeVideoUrl) {
    onClose();
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex h-[100dvh] items-center justify-center bg-black/90 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={media.type === "video" ? "Video viewer" : "Image viewer"}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white transition-colors duration-150 ease-premium hover:bg-black/70"
      >
        <X className="h-5 w-5" />
      </button>

      {media.type === "video" ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption -- generated
        // character clips have no caption track to attach.
        <video
          key={safeVideoUrl as string}
          src={safeVideoUrl as string}
          controls
          autoPlay
          playsInline
          className="max-h-[85dvh] max-w-[92vw] rounded-sm"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <div
          className="relative h-[85dvh] w-[92vw] max-w-3xl"
          onClick={(e) => e.stopPropagation()}
        >
          <Image
            src={resolveImageSrc(media.url)}
            alt=""
            fill
            sizes="92vw"
            className="object-contain"
          />
        </div>
      )}
    </div>,
    document.body,
  );
}

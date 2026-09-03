"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { SafeImage as Image } from "@/components/ui/safe-image";
import { X } from "lucide-react";
import { CharacterGallery } from "@/components/characters/character-gallery";

/**
 * Makes the chat-header avatar clickable, opening the same gallery grid +
 * lightbox already used on the character detail page's "Gallery" tab
 * (character-gallery.tsx / media-lightbox.tsx) rather than building a
 * second viewer. Only public gallery_image_urls / gallery_video_urls /
 * intro_video_url are ever passed in here (see getChatConversation in
 * lib/frontend/chat.ts) — same columns the detail page reads, not the
 * admin-only private_gallery_* ones.
 *
 * Split out of chat-header.tsx (which stays a Server Component) so the
 * "use client" boundary is just this button + modal, not the whole header.
 * The caller still does the `resolveImageSrc(characterImage)` call itself
 * (see ARCH-06 test) and hands this component the already-resolved src.
 *
 * MOBILE-EXPAND-FIX: the modal is rendered via createPortal(..., document.
 * body) rather than inline. ChatHeader (this component's parent) has
 * `backdrop-blur`, and a non-none backdrop-filter/filter makes that
 * element the containing block for any `position: fixed` descendant
 * instead of the viewport — enforced strictly by iOS/Android Safari. An
 * inline `fixed inset-0` modal here was therefore being boxed into
 * ChatHeader's own h-16 strip instead of covering the screen, which is
 * why the gallery of images/video was unreadable on phone ("fitting"
 * looked broken — it was rendering into a 64px-tall box). Porting to
 * document.body escapes that containing block entirely. GiftDrawer
 * (also a ChatHeader child, also `fixed inset-0`) has this same latent
 * bug and should get the same fix.
 */
export function ChatHeaderAvatar({
  imageSrc,
  characterName,
  introVideoUrl,
  galleryImageUrls,
  galleryVideoUrls,
}: {
  imageSrc: string;
  characterName: string;
  introVideoUrl: string | null;
  galleryImageUrls: string[];
  galleryVideoUrls: string[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`View photos and videos of ${characterName}`}
        className="relative h-10 w-10 shrink-0 rounded-full overflow-hidden border border-border-hairline"
      >
        <Image
          src={imageSrc}
          alt={characterName}
          fill
          sizes="40px"
          className="object-cover"
        />
      </button>

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
            onClick={() => setOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-label={`${characterName} photos and videos`}
          >
            <div
              className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-lg border border-border-hairline bg-base p-4 sm:rounded-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-display text-base text-text-primary">
                  {characterName}
                </h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="text-text-secondary transition-colors ease-premium hover:text-text-primary"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <CharacterGallery
                characterName={characterName}
                introVideoUrl={introVideoUrl}
                galleryImageUrls={galleryImageUrls}
                galleryVideoUrls={galleryVideoUrls}
              />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

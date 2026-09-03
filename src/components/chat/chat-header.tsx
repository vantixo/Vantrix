import Link from "next/link";
import { ChevronLeft, Brain } from "lucide-react";
import { resolveImageSrc } from "@/lib/utils";
import { GiftDrawer } from "@/components/dating/gift-drawer";
import { ChatHeaderAvatar } from "@/components/chat/chat-header-avatar";

/**
 * Sits directly under the persistent TopBar (§2). Kept as a Server
 * Component — it's static per-conversation chrome, no client state.
 * The live-status dot is the one non-text signal here; per §7 it must
 * not be gold-only (colorblind users), so it pairs a green/gray fill
 * with a label rather than relying on hue alone.
 */
export function ChatHeader({
  conversationId,
  characterId,
  characterName,
  characterImage,
  isLive,
  introVideoUrl = null,
  galleryImageUrls = [],
  galleryVideoUrls = [],
}: {
  conversationId: string;
  characterId: string;
  characterName: string;
  characterImage: string | null;
  isLive: boolean;
  introVideoUrl?: string | null;
  galleryImageUrls?: string[];
  galleryVideoUrls?: string[];
}) {
  return (
    <div className="flex h-16 shrink-0 items-center gap-3 border-b border-border-hairline bg-base/90 px-4 backdrop-blur sticky top-0 z-10">
      <Link
        href="/chats"
        className="text-text-secondary hover:text-text-primary transition-colors ease-premium"
        aria-label="Back to chats"
      >
        <ChevronLeft className="h-5 w-5" />
      </Link>
      <ChatHeaderAvatar
        imageSrc={resolveImageSrc(characterImage)}
        characterName={characterName}
        introVideoUrl={introVideoUrl}
        galleryImageUrls={galleryImageUrls}
        galleryVideoUrls={galleryVideoUrls}
      />
      <div className="min-w-0">
        <p className="font-display text-[15px] text-text-primary truncate">
          {characterName}
        </p>
        <p className="flex items-center gap-1.5 text-xs text-text-secondary">
          <span
            className={
              "h-1.5 w-1.5 rounded-full " +
              (isLive ? "bg-success" : "bg-text-tertiary")
            }
            aria-hidden
          />
          {isLive ? "Online" : "Offline"}
        </p>
      </div>
      <Link
        href={`/chat/${conversationId}/memories`}
        aria-label={`What ${characterName} remembers`}
        className="text-text-secondary transition-colors ease-premium hover:text-gold-400"
      >
        <Brain className="h-5 w-5" />
      </Link>
      <GiftDrawer characterId={characterId} characterName={characterName} />
    </div>
  );
}

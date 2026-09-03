import { SafeImage as Image } from "@/components/ui/safe-image";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { resolveImageSrc, timeAgo } from "@/lib/utils";
import type { HomeContextChat } from "@/lib/frontend/home-context";

/**
 * Reference-image parity: "Continue Your Stories" — in-progress
 * conversations.
 *
 * FAKE-DATA FIX: previously took `characters` (the generic discover
 * pool) and rendered a "progress %" bar per card computed from a
 * deterministic hash of the character id — a real-looking number with
 * no connection to any actual conversation, on characters the user may
 * never have even messaged. There's also no per-thread completion
 * concept anywhere in the schema (conversations has no progress/percent
 * column) to back that bar honestly.
 *
 * Now takes `chats` (getHomeContext().recentChats — real conversations
 * rows) and links via conversationId, which /chat/[id] actually expects
 * (that route resolves conversationId -> character, not the reverse;
 * the previous version linked /chat/${characterId}, which would 404).
 * Shows real last-message-at instead of a fabricated progress bar.
 */
export function ContinueYourStories({ chats }: { chats: HomeContextChat[] }) {
  if (chats.length === 0) return null;

  return (
    <section className="px-4 md:px-8 py-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-lg md:text-xl text-text-primary">
            Continue Your Stories
          </h2>
          <Link href="/chats" className="text-xs text-gold-400 hover:underline">
            See all
          </Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {chats.slice(0, 3).map((chat) => {
            const name = chat.character.name ?? "Companion";
            return (
              <Link
                key={chat.conversationId}
                href={`/chat/${chat.conversationId}`}
                className="relative rounded-md overflow-hidden border border-border-hairline aspect-[4/3] group"
              >
                <Image
                  src={resolveImageSrc(chat.character.image_url)}
                  alt={name}
                  fill
                  sizes="(max-width: 768px) 50vw, 33vw"
                  className="object-cover transition-transform duration-300 ease-premium group-hover:scale-[1.03]"
                />
                <div
                  className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/90 via-black/40 to-transparent"
                  aria-hidden
                />
                <div className="absolute inset-x-0 bottom-0 p-3">
                  <div className="text-text-primary text-sm font-semibold truncate">
                    {name}
                  </div>
                  {chat.lastMessageAt && (
                    <div className="flex items-center gap-1 text-text-secondary text-[11px] mt-1">
                      <MessageCircle className="h-3 w-3" strokeWidth={2} />
                      {timeAgo(chat.lastMessageAt)}
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

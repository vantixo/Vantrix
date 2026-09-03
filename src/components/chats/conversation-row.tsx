import Link from "next/link";
import { SafeImage as Image } from "@/components/ui/safe-image";
import { resolveImageSrc } from "@/lib/utils";
import { truncate } from "@/lib/utils";
import type { ConversationListItem } from "@/lib/frontend/chat";

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function ConversationRow({ item }: { item: ConversationListItem }) {
  return (
    <Link
      href={`/chat/${item.conversationId}`}
      className="flex items-center gap-3 rounded-md border border-border-hairline px-3 py-3 transition-colors duration-150 ease-premium hover:border-gold-500/40"
    >
      <div className="relative h-12 w-12 shrink-0 rounded-full overflow-hidden border border-border-hairline">
        <Image
          src={resolveImageSrc(item.character.image_url)}
          alt={item.character.name}
          fill
          sizes="48px"
          className="object-cover"
        />
        {item.character.is_live && (
          <span
            className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-success border-2 border-base"
            aria-hidden
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium text-text-primary truncate">
            {item.character.name}
          </p>
          <span className="text-xs text-text-tertiary shrink-0">
            {timeAgo(item.lastMessageAt)}
          </span>
        </div>
        <p className="text-sm text-text-secondary truncate">
          {item.lastMessage ? truncate(item.lastMessage, 60) : "Say hello..."}
        </p>
      </div>
    </Link>
  );
}

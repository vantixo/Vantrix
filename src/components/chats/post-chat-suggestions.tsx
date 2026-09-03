import { Sparkles } from "lucide-react";
import { HorizontalScrollRow } from "@/components/ui/horizontal-scroll-row";
import { CompanionCard } from "@/components/home/companion-card";
import type { DiscoverCharacter } from "@/lib/frontend/discover";

/**
 * "You Might Also Like" — lives on the Chats (conversation list) page,
 * never inside an active conversation (chat-window.tsx): a live chat is
 * the wrong place to suggest leaving it, but between conversations is
 * exactly right. Same CompanionCard/HorizontalScrollRow pair Home's
 * FeaturedCompanions already uses, so this introduces no new visual
 * pattern — see getPostChatSuggestions() for where the data comes from.
 */
export function PostChatSuggestions({
  characters,
}: {
  characters: DiscoverCharacter[];
}) {
  if (characters.length === 0) return null;

  return (
    <section className="mt-8">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="h-4 w-4 text-gold-400" />
        <h2 className="font-display text-base text-text-primary">
          You Might Also Like
        </h2>
      </div>
      <HorizontalScrollRow>
        {characters.map((c) => (
          <CompanionCard key={c.id} character={c} />
        ))}
      </HorizontalScrollRow>
    </section>
  );
}

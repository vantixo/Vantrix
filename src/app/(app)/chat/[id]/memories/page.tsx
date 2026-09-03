import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getChatConversation } from "@/lib/frontend/chat";
import { getAuthedUser } from "@/lib/auth/get-authed-user";
import { getPriorityMemories } from "@/lib/ai/priority-memory";
import { logger } from "@/lib/logger";
import { UnavailableState } from "@/components/ui/unavailable-state";
import { MemoriesPanel } from "@/components/chat/memories-panel";

export const dynamic = "force-dynamic";

/**
 * Renders priority_memories for this conversation's character — see
 * GET /api/memories/priority's own doc comment ("backing a 'memories' UI
 * page") and priority-memory.ts's header comment. `id` is a conversationId,
 * same as its parent chat/[id]/page.tsx, so ownership is checked the same
 * way (getChatConversation returns null on any not-mine condition).
 */
export default async function ChatMemoriesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const conversation = await getChatConversation(id);
  if (!conversation) notFound();

  let initialMemories: Awaited<ReturnType<typeof getPriorityMemories>> = [];
  try {
    const { user } = await getAuthedUser();
    if (!user) throw new Error("no authenticated user");
    initialMemories = await getPriorityMemories(user.id, conversation.characterId, {
      limit: 30,
    });
  } catch (error) {
    logger.error("chat-memories-page:fetch-failed", { error: String(error) });
    return (
      <div className="flex flex-col">
        <div className="flex items-center gap-3 border-b border-border-hairline px-4 py-3 sticky top-0 bg-base z-10">
          <Link
            href={`/chat/${id}`}
            className="text-text-secondary hover:text-text-primary transition-colors ease-premium"
            aria-label="Back to chat"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <p className="font-display text-[15px] text-text-primary">
            What {conversation.characterName} Remembers
          </p>
        </div>
        <div className="mx-auto max-w-2xl px-4 md:px-8 py-6 w-full">
          <UnavailableState message="Memories are temporarily unavailable — try again in a moment." />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3 border-b border-border-hairline px-4 py-3 sticky top-0 bg-base z-10">
        <Link
          href={`/chat/${id}`}
          className="text-text-secondary hover:text-text-primary transition-colors ease-premium"
          aria-label="Back to chat"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0">
          <p className="font-display text-[15px] text-text-primary truncate">
            What {conversation.characterName} Remembers
          </p>
          <p className="text-xs text-text-secondary">
            Facts and moments carried forward from your conversations
          </p>
        </div>
      </div>
      <MemoriesPanel
        characterId={conversation.characterId}
        characterName={conversation.characterName}
        initialMemories={initialMemories}
      />
    </div>
  );
}

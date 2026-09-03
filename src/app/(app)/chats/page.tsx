import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { listConversations } from "@/lib/frontend/chat";
import { ConversationRow } from "@/components/chats/conversation-row";
import { getPostChatSuggestions } from "@/lib/frontend/recommendations";
import { PostChatSuggestions } from "@/components/chats/post-chat-suggestions";

export const dynamic = "force-dynamic";

export default async function ChatsPage() {
  const [conversations, suggestions] = await Promise.all([
    listConversations(),
    getPostChatSuggestions(10),
  ]);

  return (
    <div className="mx-auto max-w-2xl px-4 md:px-8 py-6">
      <h1 className="font-display text-xl text-text-primary mb-4">Chats</h1>

      {conversations.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <MessageCircle className="h-10 w-10 text-text-tertiary" />
          <p className="text-text-secondary">No conversations yet.</p>
          <Link href="/" className="text-gold-400 hover:text-gold-300 text-sm font-medium">
            Discover companions to chat with
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {conversations.map((c) => (
            <ConversationRow key={c.conversationId} item={c} />
          ))}
        </div>
      )}

      <PostChatSuggestions characters={suggestions} />
    </div>
  );
}

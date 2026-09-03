import { notFound } from "next/navigation";
import { getChatConversation, getInitialMessages } from "@/lib/frontend/chat";
import { ChatHeader } from "@/components/chat/chat-header";
import { ChatWindow } from "@/components/chat/chat-window";

export const dynamic = "force-dynamic";

/**
 * §12 Phase 2 — "the core loop; get it real before anything else."
 * `id` here is a conversationId (see /api/conversations/[id]/messages and
 * /api/conversations/ensure, which both key on it the same way), not a
 * characterId — a character's conversation is created up front via
 * useEnsureConversation() from the character detail page, then this route
 * is what's actually navigated to.
 */
export default async function ChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const conversation = await getChatConversation(id);
  if (!conversation) notFound();

  const initialMessages = await getInitialMessages(id);

  return (
    <div className="flex h-full flex-col">
      <ChatHeader
        conversationId={conversation.id}
        characterId={conversation.characterId}
        characterName={conversation.characterName}
        characterImage={conversation.characterImage}
        isLive={conversation.isLive}
        introVideoUrl={conversation.introVideoUrl}
        galleryImageUrls={conversation.galleryImageUrls}
        galleryVideoUrls={conversation.galleryVideoUrls}
      />
      <ChatWindow
        conversationId={conversation.id}
        characterId={conversation.characterId}
        initialMessages={initialMessages}
      />
    </div>
  );
}

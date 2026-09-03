"use client";

import { Button } from "@/components/ui/button";
import { useEnsureConversation } from "@/hooks/use-ensure-conversation";

export function StartChatButton({ characterId }: { characterId: string }) {
  const { startChat, isPending, error } = useEnsureConversation();

  return (
    <div>
      <Button
        size="lg"
        onClick={() => startChat(characterId)}
        disabled={isPending}
        className="w-full sm:w-auto"
      >
        {isPending ? "Starting..." : "Start Chat"}
      </Button>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}

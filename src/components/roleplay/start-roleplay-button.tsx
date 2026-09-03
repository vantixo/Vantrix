"use client";

import { useRouter } from "next/navigation";
import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Mirrors StartChatButton's shape exactly — the counterpart entry point for Story Mode. */
export function StartRoleplayButton({ characterId }: { characterId: string }) {
  const router = useRouter();

  return (
    <Button
      size="lg"
      variant="secondary"
      onClick={() => router.push(`/roleplay/new/${characterId}`)}
      className="w-full sm:w-auto"
    >
      <BookOpen className="h-4 w-4" />
      Start a Story
    </Button>
  );
}

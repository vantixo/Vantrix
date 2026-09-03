"use client";

import { useEffect, useState } from "react";
import { AlertCircle, BookOpen } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { timeAgo } from "@/lib/utils";
import { useCharacterPage } from "@/hooks/use-character-page";
import type { CharacterStory as CharacterStoryData } from "@/hooks/use-character-page";

/**
 * Fronts GET /api/characters/[id]/story ("Our Story" — Feature 8 gap fill),
 * built to expose autobiography-engine.ts's output but never actually
 * rendered anywhere. This is that render.
 */
export function CharacterStorySection({ characterId }: { characterId: string }) {
  const { getStory } = useCharacterPage();
  const [story, setStory] = useState<CharacterStoryData | undefined>(undefined);
  const [state, setState] = useState<"loading" | "ok" | "unauthorized" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    getStory(characterId).then((result) => {
      if (cancelled) return;
      if (result.status === "ok") {
        setStory(result.data);
        setState("ok");
      } else {
        setState(result.status);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [characterId, getStory, attempt]);

  if (state === "loading") {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (state === "unauthorized") {
    return (
      <p className="py-10 text-center text-sm text-text-secondary">
        Sign in to see your story with this character.
      </p>
    );
  }

  if (state === "error") {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <AlertCircle className="h-8 w-8 text-text-tertiary" />
        <p className="text-sm text-text-secondary">Couldn&apos;t load your story with this character.</p>
        <button
          onClick={() => setAttempt((n) => n + 1)}
          className="text-xs text-gold-400 hover:text-gold-300"
        >
          Try again
        </button>
      </div>
    );
  }

  const s = story as CharacterStoryData;

  if (s.chapters.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <BookOpen className="h-8 w-8 text-text-tertiary" />
        <p className="text-sm text-text-secondary">
          No shared story yet — start chatting with {s.characterName} to begin one.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {s.headline && (
        <p className="text-center text-sm italic text-text-secondary">&quot;{s.headline}&quot;</p>
      )}
      {s.chapters.map((chapter) => (
        <div key={chapter.id}>
          <h3 className="font-display text-base text-text-primary">{chapter.title}</h3>
          <p className="mt-1 text-sm text-text-secondary leading-relaxed">
            {chapter.narrativeSummary}
          </p>
          <div className="mt-3 flex flex-col gap-2 border-l-2 border-border-hairline pl-3">
            {chapter.entries.map((entry) => (
              <div key={entry.id}>
                <div className="text-xs text-text-tertiary">
                  {entry.title} · {timeAgo(entry.occurredAt)}
                </div>
                <p className="text-sm text-text-primary">{entry.description}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

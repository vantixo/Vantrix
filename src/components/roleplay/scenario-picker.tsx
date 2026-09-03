"use client";

import { useEffect, useRef, useState } from "react";
import { SafeImage as Image } from "@/components/ui/safe-image";
import { Lock, Loader2, BookOpen, ThumbsUp, ThumbsDown } from "lucide-react";
import { cn, resolveImageSrc, SCENARIO_IMAGE_FALLBACK } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useScenarioCatalog } from "@/hooks/use-scenario-catalog";
import { useStartRoleplay } from "@/hooks/use-start-roleplay";

const ERROR_MESSAGES: Record<string, string> = {
  SCENARIO_TIER_LOCKED: "This story needs Premium — upgrade to unlock it.",
  SCENARIO_CHARACTER_MISMATCH: "This story isn't available for this character.",
  SCENARIO_FACTION_LOCKED: "Only characters connected to that faction can live this story.",
  SCENARIO_LOCATION_LOCKED: "Only characters who live there can live this story.",
  SCENARIO_NOT_FOUND: "That story couldn't be found.",
  CHARACTER_NOT_FOUND: "Character not found.",
};

export function ScenarioPicker({
  characterId,
  characterName,
  preselectSlug,
}: {
  characterId: string;
  characterName: string;
  /** Set when arriving from a scenario slug (see /roleplay/new) — auto-starts
   *  that scenario as soon as the catalog loads, instead of making the user
   *  tap "Begin" again on a story they already chose on the previous screen. */
  preselectSlug?: string;
}) {
  const { scenarios, isLoading, error: loadError, castVote, votingId, voteError } = useScenarioCatalog(characterId);
  const { startRoleplay, isPending, error: startError, clearError } = useStartRoleplay();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const autoStarted = useRef(false);

  const preselected = preselectSlug ? scenarios.find((s) => s.slug === preselectSlug) : undefined;
  const lockedCount = scenarios.filter((s) => s.locked).length;
  const hasLockedScenarios = lockedCount > 0 && lockedCount < scenarios.length;

  useEffect(() => {
    if (autoStarted.current || isLoading || !preselected || preselected.locked) return;
    autoStarted.current = true;
    setPendingId(preselected.id);
    startRoleplay(characterId, preselected.id);
  }, [isLoading, preselected, characterId, startRoleplay]);

  if (isLoading || (preselected && !preselected.locked && isPending)) {
    return (
      <div className="flex items-center justify-center py-16 text-text-tertiary">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (loadError) {
    return <p className="py-8 text-center text-sm text-danger">{loadError}</p>;
  }

  return (
    <div>
      <p className="mb-5 text-sm text-text-secondary">
        {preselected?.locked
          ? `"${preselected.title}" needs Premium — upgrade to play it, or pick another story to play out with ${characterName} below.`
          : `Pick a story to play out with ${characterName}. Each one runs across a few chapters — your choices and actions shape how it goes.`}
      </p>

      {hasLockedScenarios && (
        <p className="mb-4 rounded-sm border border-gold-500/30 bg-gold-500/10 px-3 py-2 text-sm text-gold-200">
          Try "First Date" free — the rest of Story Mode needs Premium.
        </p>
      )}

      {startError && (
        <p className="mb-4 rounded-sm border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {ERROR_MESSAGES[startError.code ?? ""] ?? startError.error}
        </p>
      )}

      {voteError && (
        <p className="mb-4 rounded-sm border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {voteError}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {scenarios.map((scenario) => (
          <Card
            key={scenario.id}
            className={cn(
              "relative flex flex-col overflow-hidden",
              scenario.locked && "opacity-60",
              scenario.slug === preselectSlug && "ring-1 ring-gold-500/60",
            )}
          >
            {scenario.cover_image_url ? (
              <div className="relative h-32 w-full">
                <Image src={resolveImageSrc(scenario.cover_image_url, SCENARIO_IMAGE_FALLBACK)} alt={scenario.title} fill sizes="(min-width: 640px) 50vw, 100vw" className="object-cover" />
              </div>
            ) : (
              <div className="flex h-32 w-full items-center justify-center bg-black/40">
                <BookOpen className="h-8 w-8 text-gold-500/30" />
              </div>
            )}

            {scenario.locked && (
              <div className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 backdrop-blur-sm">
                <Lock className="h-3.5 w-3.5 text-gold-400" />
              </div>
            )}

            <div className="flex flex-1 flex-col gap-2 p-4">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{scenario.genre}</Badge>
                <span className="text-[11px] text-text-tertiary">{scenario.chapter_count} chapters</span>
              </div>
              <h3 className="font-serif text-base font-semibold text-text-primary">{scenario.title}</h3>
              <p className="line-clamp-2 text-sm text-text-secondary">{scenario.tagline}</p>

              <div className="flex items-center gap-3 text-text-tertiary">
                <button
                  type="button"
                  disabled={votingId === scenario.id}
                  onClick={() => castVote(scenario.id, "like")}
                  className={cn(
                    "flex items-center gap-1 text-xs transition-colors ease-premium hover:text-gold-400",
                    scenario.myVote === "like" && "text-gold-400",
                  )}
                  aria-pressed={scenario.myVote === "like"}
                  aria-label="Like this story"
                >
                  <ThumbsUp className="h-3.5 w-3.5" fill={scenario.myVote === "like" ? "currentColor" : "none"} />
                  {scenario.like_count}
                </button>
                <button
                  type="button"
                  disabled={votingId === scenario.id}
                  onClick={() => castVote(scenario.id, "dislike")}
                  className={cn(
                    "flex items-center gap-1 text-xs transition-colors ease-premium hover:text-danger",
                    scenario.myVote === "dislike" && "text-danger",
                  )}
                  aria-pressed={scenario.myVote === "dislike"}
                  aria-label="Dislike this story"
                >
                  <ThumbsDown className="h-3.5 w-3.5" fill={scenario.myVote === "dislike" ? "currentColor" : "none"} />
                  {scenario.dislike_count}
                </button>
              </div>

              <Button
                size="sm"
                variant={scenario.locked ? "secondary" : "primary"}
                disabled={scenario.locked || isPending}
                onClick={() => {
                  clearError();
                  setPendingId(scenario.id);
                  startRoleplay(characterId, scenario.id);
                }}
                className="mt-auto w-full"
              >
                {isPending && pendingId === scenario.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : scenario.locked ? (
                  <Lock className="h-3.5 w-3.5" />
                ) : (
                  <BookOpen className="h-3.5 w-3.5" />
                )}
                {scenario.locked ? "Premium" : "Begin"}
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

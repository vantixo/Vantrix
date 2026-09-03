"use client";

import { useEffect } from "react";
import { SafeImage as Image } from "@/components/ui/safe-image";
import Link from "next/link";
import { Heart, X } from "lucide-react";
import { resolveImageSrc } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { DeckCandidate, SwipeResult } from "@/hooks/use-dating-deck";

export function MatchCelebration({
  match,
  candidate,
  onDismiss,
}: {
  match: SwipeResult;
  candidate: DeckCandidate;
  onDismiss: () => void;
}) {
  // Escape-to-close for keyboard users — role/aria-modal were already in
  // place below, this closes the last gap versus media-lightbox.tsx's
  // overlay pattern.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onDismiss]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label="You matched"
    >
      <button
        onClick={onDismiss}
        aria-label="Close"
        className="absolute top-5 right-5 text-text-secondary hover:text-text-primary"
      >
        <X className="h-6 w-6" />
      </button>

      <div className="w-full max-w-sm text-center">
        <div className="flex items-center justify-center gap-1 text-gold-400">
          <Heart className="h-6 w-6 fill-current" />
          <Heart className="h-8 w-8 fill-current" />
          <Heart className="h-6 w-6 fill-current" />
        </div>
        <h1 className="mt-3 font-display text-3xl text-text-primary">It&rsquo;s a Match!</h1>
        <p className="mt-1 text-text-secondary">
          You and {candidate.name} liked each other.
        </p>

        <div className="relative mt-6 aspect-[4/5] w-full overflow-hidden rounded-lg border border-gold-500/40 shadow-gold-glow">
          <Image
            src={resolveImageSrc(candidate.image_url)}
            alt={candidate.name}
            fill
            sizes="384px"
            className="object-cover"
          />
        </div>

        {match.compatibility && (
          <p className="mt-4 text-sm text-text-secondary">
            <span className="text-gold-400 font-semibold">
              {match.compatibility.score}% compatible
            </span>{" "}
            · {match.compatibility.tier} match
          </p>
        )}

        <div className="mt-6 flex flex-col gap-3">
          {match.match && (
            <Button asChild size="lg">
              <Link href={`/dating/match/${match.match.id}`}>Say Hello</Link>
            </Button>
          )}
          <Button variant="ghost" onClick={onDismiss}>
            Keep Swiping
          </Button>
        </div>
      </div>
    </div>
  );
}

import { SafeImage as Image } from "@/components/ui/safe-image";
import Link from "next/link";
import { Lock, Sparkles } from "lucide-react";
import { resolveImageSrc, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { DatingWorldCandidate } from "@/lib/frontend/dating";

/**
 * RETENTION-01: free-tier equivalent of TonightMatchCard. Same slot, same
 * daily-pinned candidate (see getDatingWorldHome's tonightKey/TONIGHT_TTL —
 * this is deliberately the exact same match a premium user would see, not a
 * separate/fake one, so upgrading mid-day reveals *this* person rather than
 * swapping them out) — just rendered as a locked teaser instead of a full
 * reveal. Photo and name are obscured client-side (blur), not withheld by
 * the API — see the isPremium comment in get-world-home.ts for why that's
 * the right layer for this particular gate.
 */
export function LockedTonightMatchCard({
  candidate,
  className,
}: {
  candidate: DatingWorldCandidate;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md border border-gold-500/30 bg-base",
        className
      )}
    >
      <div className="relative aspect-[16/9] w-full sm:aspect-[21/9]">
        <Image
          src={resolveImageSrc(candidate.image_url)}
          alt="Tonight's Match — locked until you upgrade"
          fill
          sizes="(max-width: 640px) 100vw, 800px"
          className="scale-110 object-cover blur-2xl"
        />
        <div
          className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/70 to-black/40"
          aria-hidden
        />
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-start gap-3 p-4 sm:p-6">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-gold-400">
            <Lock className="h-3 w-3" /> Tonight&apos;s Match
          </p>
          <div>
            <h3
              className="select-none font-display text-2xl text-text-primary blur-[6px]"
              aria-hidden
            >
              {candidate.name}
            </h3>
            <p className="mt-1 max-w-md text-sm text-text-secondary">
              <span className="font-semibold text-gold-400">{candidate.score}% match</span> —
              someone was picked for you tonight. Unlock Premium to see who.
            </p>
          </div>
          <Button size="sm" asChild>
            <Link href="/premium">
              <Sparkles className="h-4 w-4" />
              Unlock Tonight&apos;s Match
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

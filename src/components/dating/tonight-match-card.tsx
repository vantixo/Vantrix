import { SafeImage as Image } from "@/components/ui/safe-image";
import Link from "next/link";
import { resolveImageSrc, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { DatingWorldCandidate } from "@/lib/frontend/dating";

export function TonightMatchCard({
  candidate,
  eyebrow,
  className,
}: {
  candidate: DatingWorldCandidate;
  eyebrow: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md border border-border-hairline bg-base",
        className
      )}
    >
      <div className="relative aspect-[16/9] w-full sm:aspect-[21/9]">
        <Image
          src={resolveImageSrc(candidate.image_url)}
          alt={candidate.name}
          fill
          sizes="(max-width: 640px) 100vw, 800px"
          className="object-cover"
        />
        <div
          className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent"
          aria-hidden
        />
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-3 p-4 sm:p-6">
          <p className="text-xs font-bold uppercase tracking-wide text-gold-400">
            {eyebrow}
          </p>
          <div>
            <h3 className="font-display text-2xl text-text-primary">
              {candidate.name}
              {candidate.age ? (
                <span className="ml-2 text-lg font-normal text-text-secondary">
                  {candidate.age}
                </span>
              ) : null}
            </h3>
            <p className="mt-1 max-w-md text-sm text-text-secondary">{candidate.reason}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-gold-400">
              {candidate.score}% match
            </span>
            <Button size="sm" asChild>
              <Link href={`/characters/${candidate.id}`}>View Profile</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

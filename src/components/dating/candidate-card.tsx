import { MediaCard } from "@/components/ui/media-card";
import { Badge } from "@/components/ui/badge";
import { cn, resolveImageSrc } from "@/lib/utils";
import type { DatingWorldCandidate } from "@/lib/frontend/dating";

export function CandidateCard({
  candidate,
  className,
}: {
  candidate: DatingWorldCandidate;
  className?: string;
}) {
  return (
    <MediaCard
      href={`/characters/${candidate.id}`}
      image={resolveImageSrc(candidate.image_url)}
      alt={candidate.name}
      badge={candidate.is_new ? <Badge>New</Badge> : undefined}
      className={cn("shrink-0 w-[168px] sm:w-[200px]", className)}
    >
      <div className="truncate text-[15px] font-semibold leading-tight text-text-primary">
        {candidate.name}
        {candidate.age ? (
          <span className="font-normal text-text-secondary">, {candidate.age}</span>
        ) : null}
      </div>
      <div className="mt-0.5 truncate text-xs text-gold-400">{candidate.score}% match</div>
    </MediaCard>
  );
}

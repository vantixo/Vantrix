import { SafeImage as Image } from "@/components/ui/safe-image";
import Link from "next/link";
import { Flame } from "lucide-react";
import { resolveImageSrc, cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { DATING_TIER_LABELS, type DatingMatchTier } from "@/lib/dating/constants";
import type { DatingWorldRelationship } from "@/lib/frontend/dating";

export function WorldRelationshipCard({
  relationship,
  className,
}: {
  relationship: DatingWorldRelationship;
  className?: string;
}) {
  const character = relationship.character;
  if (!character) return null;
  const tier = (relationship.match_tier as DatingMatchTier) ?? "spark";

  return (
    <Link href={`/dating/match/${relationship.id}`} className={cn("shrink-0", className)}>
      <Card className="w-[136px] p-2 sm:w-[152px]">
        <div className="relative aspect-square w-full overflow-hidden rounded-sm">
          <Image
            src={resolveImageSrc(character.image_url)}
            alt={character.name}
            fill
            sizes="152px"
            className="object-cover"
          />
        </div>
        <p className="mt-2 truncate text-sm font-medium text-text-primary">{character.name}</p>
        <p className="truncate text-xs text-text-secondary">
          {DATING_TIER_LABELS[tier] ?? tier} · Bond {relationship.bond_score}
        </p>
        {relationship.streak_days > 0 && (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-gold-400">
            <Flame className="h-3 w-3" />
            {relationship.streak_days}
          </p>
        )}
      </Card>
    </Link>
  );
}

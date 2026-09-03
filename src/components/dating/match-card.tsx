import { SafeImage as Image } from "@/components/ui/safe-image";
import Link from "next/link";
import { Flame } from "lucide-react";
import { resolveImageSrc } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { DATING_TIER_LABELS, type DatingMatchTier } from "@/lib/dating/constants";
import type { DatingMatch } from "@/lib/frontend/dating";

export function MatchCard({ match }: { match: DatingMatch }) {
  const character = match.character;
  if (!character) return null;

  return (
    <Link href={`/dating/match/${match.id}`}>
      <Card className="flex items-center gap-4 p-3">
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md">
          <Image
            src={resolveImageSrc(character.image_url)}
            alt={character.name}
            fill
            sizes="64px"
            className="object-cover"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate font-medium text-text-primary">{character.name}</p>
            {match.compatibility_pct !== null && (
              <span className="shrink-0 text-sm font-semibold text-gold-400">
                {match.compatibility_pct}%
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-sm text-text-secondary">
            {match.match_tier
              ? DATING_TIER_LABELS[match.match_tier as DatingMatchTier] ?? match.match_tier
              : "Spark"}
            {" · "}
            Bond {match.bond_score}
          </p>
        </div>
        {match.streak_days !== null && match.streak_days > 0 && (
          <span className="flex shrink-0 items-center gap-1 text-sm text-gold-400">
            <Flame className="h-4 w-4" />
            {match.streak_days}
          </span>
        )}
      </Card>
    </Link>
  );
}

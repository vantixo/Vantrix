import { SafeImage as Image } from "@/components/ui/safe-image";
import Link from "next/link";
import { resolveImageSrc } from "@/lib/utils";
import { VisibilityToggle } from "./visibility-toggle";
import { cn } from "@/lib/utils";
import type { MyCharacter, MarketCharacter } from "@/lib/frontend/studio";

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
};

const STATUS_TONE: Record<string, string> = {
  pending: "text-text-secondary",
  approved: "text-gold-400",
  rejected: "text-danger",
};

export function MyCharacterRow({ character }: { character: MyCharacter }) {
  const status = character.moderation_status;
  return (
    <div className="flex items-center gap-3 rounded-md border border-border-hairline px-4 py-3">
      {/* Links into the Creator Studio edit view (builder tabs, LoRA
          training, animate, export) rather than the public character
          page — that's what a creator wants from their own Studio list;
          the edit page itself links back out to the public page. */}
      <Link href={`/studio/${character.id}`} className="shrink-0">
        <div className="relative h-12 w-12 rounded-md overflow-hidden">
          <Image
            src={resolveImageSrc(character.image_url)}
            alt={character.name}
            fill
            sizes="48px"
            className="object-cover"
          />
        </div>
      </Link>
      <Link href={`/studio/${character.id}`} className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-text-primary truncate">
          {character.name}
        </div>
        <div className={cn("text-xs mt-0.5", STATUS_TONE[status] ?? "text-text-secondary")}>
          {STATUS_LABEL[status] ?? status}
        </div>
        {status === "rejected" && character.moderation_note && (
          <div className="text-xs text-text-tertiary mt-0.5 line-clamp-1">
            {character.moderation_note}
          </div>
        )}
      </Link>
      <VisibilityToggle
        characterId={character.id}
        isPublic={character.is_public}
        canGoPublic={status === "approved"}
      />
    </div>
  );
}

// §1: no mixed accent colors, even for a multi-tier distinction like
// rarity — gold intensity (+ weight for the top tier) carries the
// gradient instead of introducing blue/emerald/purple outside the
// theme's token scale.
const RARITY_TONE: Record<string, string> = {
  common: "text-text-tertiary",
  uncommon: "text-text-secondary",
  rare: "text-text-primary",
  epic: "text-gold-300",
  legendary: "text-gold-400 font-semibold",
  mythic: "text-gold-200 font-semibold",
};

export function MarketCharacterCard({ character, rank }: { character: MarketCharacter; rank: number }) {
  return (
    <Link
      href={`/characters/${character.character_id}`}
      className="flex items-center gap-3 rounded-md border border-border-hairline px-4 py-3 hover:border-gold-500/40 transition-colors ease-premium"
    >
      <span className="text-text-tertiary text-sm font-semibold w-5 shrink-0 tabular-nums">
        {rank}
      </span>
      <div className="relative h-11 w-11 rounded-md overflow-hidden shrink-0">
        <Image
          src={resolveImageSrc(character.image_url)}
          alt={character.name}
          fill
          sizes="44px"
          className="object-cover"
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-text-primary truncate">
          {character.name}
        </div>
        <div className={cn("text-xs capitalize", RARITY_TONE[character.rarity_tier] ?? "text-text-secondary")}>
          {character.rarity_tier}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-sm text-gold-400 font-semibold tabular-nums">
          {character.value_score.toLocaleString()}
        </div>
        <div className="text-[11px] text-text-tertiary">
          top {Math.max(1, Math.round(100 - character.percentile))}%
        </div>
      </div>
    </Link>
  );
}

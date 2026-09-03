import { BookOpen, Moon, Compass, Headphones, Palette, Sparkles, MoonStar, Heart, Coffee } from "lucide-react";
import { cn } from "@/lib/utils";
import { getCharacterPresence, type PresenceIconKey } from "@/lib/characters/presence";

/**
 * Phase 1 Immersive UI Upgrade §10/§14. Deliberately NOT an "online"
 * dot — see lib/characters/presence.ts's module doc for why. Renders
 * server-side (no client JS, no network call): the whole point of §14's
 * "do not make an LLM request simply to determine whether a character is
 * online" is that this costs nothing to render on every page view.
 */
const ICONS: Record<PresenceIconKey, typeof Sparkles> = {
  book: BookOpen,
  moon: Moon,
  compass: Compass,
  headphones: Headphones,
  palette: Palette,
  sparkle: Sparkles,
  "moon-star": MoonStar,
  heart: Heart,
  coffee: Coffee,
};

export function CharacterPresence({
  characterId,
  tags,
  allowRememberingYou = false,
  showFlavor = false,
  className,
}: {
  characterId: string;
  tags?: string[];
  allowRememberingYou?: boolean;
  /** Show the first-person flavor line — only use on larger surfaces (hero), not compact cards. */
  showFlavor?: boolean;
  className?: string;
}) {
  const presence = getCharacterPresence(characterId, tags, allowRememberingYou);
  const Icon = ICONS[presence.icon];

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="inline-flex w-fit items-center gap-1.5 rounded-full border border-border-hairline bg-black/40 backdrop-blur-sm px-3 py-1">
        <Icon className="h-3.5 w-3.5 text-gold-400" strokeWidth={2} />
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-secondary">
          {presence.label}
        </span>
      </div>
      {showFlavor && presence.flavor && (
        <p className="text-sm italic text-text-secondary/90 max-w-sm">&ldquo;{presence.flavor}&rdquo;</p>
      )}
    </div>
  );
}

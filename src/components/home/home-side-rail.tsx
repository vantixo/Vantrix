import { SafeImage as Image } from "@/components/ui/safe-image";
import Link from "next/link";
import { resolveImageSrc } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { DiscoverCharacter } from "@/lib/frontend/discover";
import type { HomeContextInitiative } from "@/lib/frontend/home-context";

/**
 * Reference-image parity: the screenshot's right rail stacks three
 * widgets — "Someone is thinking about you", "Live Now", "Today's
 * Moments". Per the brief ("remove live") the Live Now widget is
 * dropped entirely rather than hidden/disabled, so this rail ships with
 * two widgets, not three. Desktop-only (`hidden lg:flex`) — narrower
 * viewports get this content folded into the main column instead via
 * TodaysMoments below, same "distinct layout, not one reflowed tree"
 * approach Hero already established.
 *
 * FAKE-DATA FIX: "Someone is thinking about you" previously showed
 * spotlight[0] — whichever character happened to be first in the
 * discover feed, regardless of whether they'd actually reached out.
 * Now driven by `initiatives` (real character_initiatives rows via
 * getHomeContext) — this widget only renders when a character has
 * genuinely initiated something for this user, showing their real
 * message instead of a generic "reason" string.
 */
export function HomeSideRail({
  spotlight,
  initiatives,
}: {
  spotlight: DiscoverCharacter[];
  initiatives: HomeContextInitiative[];
}) {
  const thinking = initiatives[0];
  const moments = spotlight.slice(0, 3);

  if (!thinking && moments.length === 0) return null;

  return (
    <aside className="hidden lg:flex flex-col gap-5 w-[280px] shrink-0">
      {thinking && (
        <div className="rounded-md border border-border-hairline bg-black/30 p-4">
          <p className="text-sm text-text-primary font-semibold mb-3">
            Someone is thinking about you <span className="text-gold-400">♥</span>
          </p>
          <Link
            href={`/characters/${thinking.character.id}`}
            className="flex items-center gap-3 group"
          >
            <div className="relative h-11 w-11 rounded-full overflow-hidden shrink-0 border border-border-hairline">
              <Image
                src={resolveImageSrc(thinking.character.image_url)}
                alt={thinking.character.name}
                fill
                sizes="44px"
                className="object-cover"
              />
            </div>
            <div className="min-w-0">
              <div className="text-text-primary text-sm font-medium truncate">
                {thinking.character.name}
              </div>
              <div className="text-text-secondary text-xs truncate">
                &ldquo;{thinking.message}&rdquo;
              </div>
            </div>
          </Link>
          <Button asChild size="sm" className="w-full mt-3">
            <Link href={`/characters/${thinking.character.id}`}>
              Talk to {thinking.character.name}
            </Link>
          </Button>
        </div>
      )}

      {moments.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-text-primary font-semibold">Today&rsquo;s Moments</p>
            <Link href="/characters" className="text-xs text-gold-400 hover:underline">
              See all
            </Link>
          </div>
          <div className="flex items-center gap-3">
            {moments.map((c) => (
              <Link
                key={c.id}
                href={`/characters/${c.id}`}
                className="relative h-14 w-14 rounded-full overflow-hidden border-2 border-gold-500/60 shrink-0"
              >
                <Image
                  src={resolveImageSrc(c.image_url)}
                  alt={c.name}
                  fill
                  sizes="56px"
                  className="object-cover"
                />
              </Link>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

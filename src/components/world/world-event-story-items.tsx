import Link from "next/link";
import { SafeImage as Image } from "@/components/ui/safe-image";
import { Zap, BookOpen } from "lucide-react";
import { Card } from "@/components/ui/card";
import { resolveImageSrc } from "@/lib/utils";
import type { WorldEvent, WorldStory } from "@/types/world-expansion";

export function WorldEventItem({ event }: { event: WorldEvent }) {
  return (
    <Card interactive={false} className="p-4 flex gap-3">
      <Zap className="h-4 w-4 text-gold-500 shrink-0 mt-0.5" strokeWidth={1.75} />
      <div className="min-w-0">
        <div className="text-sm font-semibold text-text-primary">{event.title}</div>
        <p className="text-xs text-text-secondary mt-0.5 line-clamp-2">
          {event.description}
        </p>
      </div>
    </Card>
  );
}

export function WorldStoryItem({ story }: { story: WorldStory }) {
  const cast = story.participant_characters ?? [];
  return (
    <Card interactive={false} className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs text-gold-400 font-semibold uppercase tracking-wide">
            <BookOpen className="h-3.5 w-3.5" /> Chapter {story.chapter}
          </div>
          <h3 className="text-sm font-semibold text-text-primary mt-1">
            {story.title}
          </h3>
          <p className="text-xs text-text-secondary mt-1 line-clamp-2">
            {story.description}
          </p>
        </div>
        {cast.length > 0 && (
          <div className="flex -space-x-2 shrink-0">
            {cast.slice(0, 3).map((c) => (
              <Link key={c.id} href={`/characters/${c.id}`} className="block">
                <div className="relative h-8 w-8 rounded-full overflow-hidden border-2 border-base">
                  <Image
                    src={resolveImageSrc(c.image_url)}
                    alt={c.name}
                    fill
                    sizes="32px"
                    className="object-cover"
                  />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

import Link from "next/link";
import { SafeImage as Image } from "@/components/ui/safe-image";
import { Crown, Play, Sparkles } from "lucide-react";
import { HorizontalScrollRow } from "@/components/ui/horizontal-scroll-row";
import { MediaCard } from "@/components/ui/media-card";
import { Badge } from "@/components/ui/badge";
import { resolveImageSrc } from "@/lib/utils";
import { formatGenreLabel } from "@/lib/universe/scene-genres.client";
import type { FeaturedScene } from "@/lib/universe/world-atlas";

/**
 * "Legendary Scenes" — Home's highlight reel for the Scene Builder
 * (/world/locations/[slug], see SceneStudio). Pulled from
 * getFeaturedScenes(), which ranks by production value (video presence,
 * faction tie-in, capital-city setting, cast size) since there's no
 * likes/views column on universe_scenes to rank by popularity instead —
 * see that function's own doc comment in world-atlas.ts.
 */
export function FeaturedScenes({ scenes }: { scenes: FeaturedScene[] }) {
  if (scenes.length === 0) return null;

  return (
    <section className="px-4 md:px-8 py-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-xl md:text-2xl text-text-primary">
            Legendary Scenes
          </h2>
          <Link
            href="/world"
            className="text-sm font-semibold text-gold-400 hover:text-gold-300 transition-colors ease-premium"
          >
            Explore the World
          </Link>
        </div>

        <HorizontalScrollRow>
          {scenes.map((scene) => (
            <SceneTile key={scene.id} scene={scene} />
          ))}
        </HorizontalScrollRow>
      </div>
    </section>
  );
}

function SceneTile({ scene }: { scene: FeaturedScene }) {
  // Mirrors the score weighting in getFeaturedUniverseScenes, just
  // collapsed to two display tiers instead of the underlying number —
  // video + faction together is the rarest, most expensive combination
  // this pipeline produces.
  const legendary = !!scene.video_url && !!scene.faction;
  const epic = !legendary && (!!scene.video_url || !!scene.faction);

  const badge = legendary ? (
    <Badge className="gap-1">
      <Crown className="h-3 w-3" strokeWidth={2.5} />
      Legendary
    </Badge>
  ) : epic ? (
    <Badge variant="outline" className="gap-1">
      <Sparkles className="h-3 w-3" />
      Epic
    </Badge>
  ) : undefined;

  return (
    <MediaCard
      href={`/world/locations/${scene.location.slug}`}
      image={resolveImageSrc(scene.image_url)}
      alt={`${formatGenreLabel(scene.genre)} scene in ${scene.location.name}`}
      badge={badge}
      imageClassName="aspect-video"
      className="shrink-0 w-[260px] sm:w-[300px]"
    >
      <div className="text-text-primary font-semibold text-[15px] leading-tight truncate">
        {scene.location.name}
      </div>
      <div className="flex items-center gap-1 mt-0.5 text-text-secondary text-xs">
        {scene.video_url && (
          <Play className="h-3 w-3 fill-gold-400 text-gold-400 shrink-0" strokeWidth={0} />
        )}
        <span className="truncate">
          {formatGenreLabel(scene.genre)}
          {scene.faction ? ` · ${scene.faction.name}` : ""}
        </span>
      </div>
      {scene.cast.length > 0 && (
        <div className="flex items-center -space-x-2 mt-1.5">
          {scene.cast.slice(0, 4).map((c) => (
            <div key={c.id} className="relative h-6 w-6 rounded-full overflow-hidden border border-black/60">
              <Image src={resolveImageSrc(c.image_url)} alt={c.name} fill sizes="24px" className="object-cover" />
            </div>
          ))}
          {scene.cast.length > 4 && (
            <div className="relative h-6 w-6 rounded-full border border-black/60 bg-black/70 flex items-center justify-center text-[10px] text-white">
              +{scene.cast.length - 4}
            </div>
          )}
        </div>
      )}
    </MediaCard>
  );
}

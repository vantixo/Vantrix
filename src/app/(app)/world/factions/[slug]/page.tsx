import { SafeImage as Image } from "@/components/ui/safe-image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TrendingUp, TrendingDown, Crown, Sparkles as SparklesIcon, Skull } from "lucide-react";
import { getWorldFaction } from "@/lib/frontend/world";
import { listScenariosForFaction } from "@/lib/roleplay/scenarios";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { resolveImageSrc, WORLD_IMAGE_FALLBACK } from "@/lib/utils";
import { WorldScenariosSection } from "@/components/world/world-scenarios-section";

export const dynamic = "force-dynamic";

export default async function FactionDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [faction, scenarios] = await Promise.all([
    getWorldFaction(slug),
    listScenariosForFaction(slug),
  ]);
  if (!faction) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 md:px-8 py-6">
      <div className="relative aspect-[16/7] w-full rounded-lg overflow-hidden border border-border-hairline">
        <Image
          src={resolveImageSrc(faction.image_url, WORLD_IMAGE_FALLBACK)}
          alt={faction.name}
          fill
          sizes="(max-width: 768px) 100vw, 640px"
          priority
          className="object-cover"
        />
        {faction.is_ruling && (
          <div className="absolute top-3 left-3">
            <Badge>Ruling</Badge>
          </div>
        )}
      </div>

      <div className="mt-5">
        <h1 className="font-display text-2xl text-text-primary">{faction.name}</h1>
        <p className="text-sm text-text-secondary mt-1">
          {faction.ideology}
          {faction.location && (
            <>
              {" "}
              ·{" "}
              <Link
                href={`/world/locations/${faction.location.slug}`}
                className="text-gold-400 hover:text-gold-300"
              >
                {faction.location.name}
              </Link>
            </>
          )}
        </p>
        {faction.motto && (
          <p className="text-sm text-gold-400 italic mt-2">&ldquo;{faction.motto}&rdquo;</p>
        )}
        <p className="text-[15px] text-text-primary leading-relaxed mt-4">
          {faction.description}
        </p>

        <div className="mt-4 flex items-center gap-2">
          <span className="text-xs text-text-secondary uppercase tracking-wide">Influence</span>
          <div className="flex-1 max-w-[200px] h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className="h-full bg-gold-fill"
              style={{ width: `${Math.min(100, Math.max(0, faction.influence))}%` }}
            />
          </div>
          <span className="text-xs text-gold-400 font-semibold tabular-nums">
            {faction.influence}%
          </span>
        </div>
      </div>

      {faction.evolution_log.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
            Recent History
          </h2>
          <div className="space-y-2">
            {faction.evolution_log.map((e) => {
              const Icon =
                e.change_type === "ruling_change"
                  ? Crown
                  : e.change_type === "founded"
                  ? SparklesIcon
                  : e.change_type === "dissolved"
                  ? Skull
                  : e.delta != null && e.delta < 0
                  ? TrendingDown
                  : TrendingUp;
              return (
                <div
                  key={e.id}
                  className="flex items-start gap-2.5 rounded-sm border border-border-hairline px-3.5 py-2.5"
                >
                  <Icon className="h-4 w-4 text-gold-500 shrink-0 mt-0.5" strokeWidth={1.75} />
                  <p className="text-sm text-text-secondary leading-relaxed">
                    {e.note ?? e.change_type.replace("_", " ")}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {faction.members.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
            Members ({faction.member_count})
          </h2>
          <div className="flex flex-col gap-2">
            {faction.members
              .filter((m) => m.is_public && m.character)
              .map((m) => (
                <Card key={m.character_id} className="p-0">
                  <Link
                    href={`/characters/${m.character_id}`}
                    className="flex items-center gap-3 px-3 py-2"
                  >
                    <div className="relative h-9 w-9 rounded-full overflow-hidden shrink-0">
                      <Image
                        src={resolveImageSrc(m.character?.image_url)}
                        alt={m.character?.name ?? ""}
                        fill
                        sizes="36px"
                        className="object-cover"
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm text-text-primary font-medium truncate">
                        {m.character?.name}
                      </div>
                      <div className="text-xs text-text-secondary capitalize">{m.role}</div>
                    </div>
                  </Link>
                </Card>
              ))}
          </div>
        </section>
      )}

      <WorldScenariosSection scenarios={scenarios} />
    </div>
  );
}

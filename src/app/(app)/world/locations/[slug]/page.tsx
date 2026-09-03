import { SafeImage as Image } from "@/components/ui/safe-image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Landmark, Users, Cloud, ShieldAlert, Sparkles, Church, TrendingUp, TrendingDown, Clapperboard, Flame, Handshake } from "lucide-react";
import { getWorldLocation } from "@/lib/frontend/world";
import { listScenariosForLocation } from "@/lib/roleplay/scenarios";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { resolveImageSrc, WORLD_IMAGE_FALLBACK } from "@/lib/utils";
import { SceneStudio } from "@/components/universe/scene-studio";
import { WorldScenariosSection } from "@/components/world/world-scenarios-section";

export const dynamic = "force-dynamic";

export default async function LocationDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [location, scenarios] = await Promise.all([
    getWorldLocation(slug),
    listScenariosForLocation(slug),
  ]);
  if (!location) notFound();

  return (
    <div className="mx-auto max-w-4xl px-4 md:px-8 py-6">
      <div className="relative aspect-[16/7] w-full rounded-lg overflow-hidden border border-border-hairline">
        <Image
          src={resolveImageSrc(location.image_url, WORLD_IMAGE_FALLBACK)}
          alt={location.name}
          fill
          sizes="(max-width: 768px) 100vw, 768px"
          priority
          className="object-cover"
        />
        {location.is_capital && (
          <div className="absolute top-3 left-3">
            <Badge>Capital</Badge>
          </div>
        )}
      </div>

      <div className="mt-5">
        <h1 className="font-display text-2xl text-text-primary">{location.name}</h1>
        <p className="text-sm text-text-secondary mt-1 capitalize">
          {location.archetype} · {location.culture} · {location.population.toLocaleString()} residents
        </p>
        {location.seal_motto && (
          <p className="text-sm text-gold-400 italic mt-2">&ldquo;{location.seal_motto}&rdquo;</p>
        )}
        <p className="text-[15px] text-text-primary leading-relaxed mt-4">
          {location.description}
        </p>
      </div>

      {location.crisis && (
        <Card interactive={false} className="p-4 mt-6 border-danger/40 bg-danger/5">
          <div className="flex items-start gap-2.5">
            <Flame className="h-4 w-4 text-danger shrink-0 mt-0.5" strokeWidth={1.75} />
            <div>
              <h2 className="text-sm font-semibold text-danger uppercase tracking-wide mb-1">
                {location.crisis.crisis_type.replace("_", " ")} · Severity {location.crisis.severity}
              </h2>
              <p className="text-sm text-text-primary font-medium">{location.crisis.title}</p>
              <p className="text-sm text-text-secondary leading-relaxed mt-1">
                {location.crisis.description}
              </p>
            </div>
          </div>
        </Card>
      )}

      {(location.pulse.weather || location.pulse.inflation || location.pulse.crime.length > 0 || location.pulse.culture.length > 0 || location.pulse.religion.length > 0) && (
        <Card interactive={false} className="p-4 mt-6">
          <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
            Right Now
          </h2>
          <div className="space-y-3">
            {location.pulse.weather && (
              <div className="flex items-start gap-2.5">
                <Cloud className="h-4 w-4 text-gold-500 shrink-0 mt-0.5" strokeWidth={1.75} />
                <p className="text-sm text-text-primary leading-relaxed">
                  {location.pulse.weather.description}
                </p>
              </div>
            )}
            {location.pulse.inflation && (
              <div className="flex items-start gap-2.5">
                {location.pulse.inflation.inflation_rate >= 0 ? (
                  <TrendingUp className="h-4 w-4 text-gold-500 shrink-0 mt-0.5" strokeWidth={1.75} />
                ) : (
                  <TrendingDown className="h-4 w-4 text-gold-500 shrink-0 mt-0.5" strokeWidth={1.75} />
                )}
                <p className="text-sm text-text-primary leading-relaxed">
                  Prices here have {location.pulse.inflation.inflation_rate >= 0 ? "risen" : "fallen"} about{" "}
                  {Math.abs(Math.round(location.pulse.inflation.inflation_rate * 1000) / 10)}% over the past year.
                </p>
              </div>
            )}
            {location.pulse.crime.map((c, i) => (
              <div key={`crime-${i}`} className="flex items-start gap-2.5">
                <ShieldAlert className="h-4 w-4 text-text-tertiary shrink-0 mt-0.5" strokeWidth={1.75} />
                <p className="text-sm text-text-secondary leading-relaxed">
                  <span className="text-text-primary font-medium">{c.title}.</span> {c.description}
                </p>
              </div>
            ))}
            {location.pulse.culture.map((c, i) => (
              <div key={`culture-${i}`} className="flex items-start gap-2.5">
                <Sparkles className="h-4 w-4 text-text-tertiary shrink-0 mt-0.5" strokeWidth={1.75} />
                <p className="text-sm text-text-secondary leading-relaxed">
                  <span className="text-text-primary font-medium">{c.title}.</span> {c.description}
                </p>
              </div>
            ))}
            {location.pulse.religion.map((c, i) => (
              <div key={`religion-${i}`} className="flex items-start gap-2.5">
                <Church className="h-4 w-4 text-text-tertiary shrink-0 mt-0.5" strokeWidth={1.75} />
                <p className="text-sm text-text-secondary leading-relaxed">
                  <span className="text-text-primary font-medium">{c.title}.</span> {c.description}
                </p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {(location.governance || location.economy) && (
        <div className="grid sm:grid-cols-2 gap-4 mt-6">
          {location.governance && (
            <Card interactive={false} className="p-4">
              <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
                Governance
              </h2>
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-text-secondary">Type</dt>
                  <dd className="text-text-primary capitalize">{location.governance.government_type}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-text-secondary">Approval</dt>
                  <dd className="text-gold-400 tabular-nums">{location.governance.approval_rating}%</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-text-secondary">Stability</dt>
                  <dd className="text-text-primary tabular-nums">{location.governance.stability}%</dd>
                </div>
              </dl>
            </Card>
          )}
          {location.economy && (
            <Card interactive={false} className="p-4">
              <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
                Economy
              </h2>
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-text-secondary">Primary industry</dt>
                  <dd className="text-text-primary capitalize">{location.economy.primary_industry}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-text-secondary">GDP</dt>
                  <dd className="text-gold-400 tabular-nums">{location.economy.gdp.toLocaleString()}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-text-secondary">Unemployment</dt>
                  <dd className="text-text-primary tabular-nums">{location.economy.unemployment}%</dd>
                </div>
              </dl>
            </Card>
          )}
        </div>
      )}

      {location.diplomacy.length > 0 && (
        <section className="mt-6">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
            <Handshake className="h-3.5 w-3.5" /> Foreign Relations
          </h2>
          <div className="grid sm:grid-cols-2 gap-2">
            {location.diplomacy.map((rel) => (
              <div
                key={rel.id}
                className="flex items-center justify-between rounded-sm border border-border-hairline px-3.5 py-2.5 text-sm"
              >
                <Link
                  href={rel.other_location ? `/world/locations/${rel.other_location.slug}` : "#"}
                  className="text-text-primary hover:text-gold-400 transition-colors ease-premium truncate"
                >
                  {rel.other_location?.name ?? "Unknown city"}
                </Link>
                <span
                  className={
                    "text-xs font-semibold uppercase tracking-wide shrink-0 ml-2 " +
                    (rel.status === "allied" || rel.status === "friendly"
                      ? "text-gold-400"
                      : rel.status === "hostile" || rel.status === "at_war"
                      ? "text-danger"
                      : "text-text-tertiary")
                  }
                >
                  {rel.status.replace("_", " ")}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {location.factions.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
            Factions Here
          </h2>
          <div className="flex flex-wrap gap-2">
            {location.factions.map((f) => (
              <Link
                key={f.id}
                href={`/world/factions/${f.slug}`}
                className="flex items-center gap-1.5 rounded-full border border-border-hairline px-3 py-1.5 text-sm text-text-secondary hover:text-gold-400 hover:border-gold-500/40 transition-colors ease-premium"
              >
                <Landmark className="h-3.5 w-3.5" />
                {f.name}
                <span className="text-text-tertiary">· {f.member_count}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {location.residents.length > 0 && (
        <section className="mt-6">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
            <Users className="h-3.5 w-3.5" /> Residents
          </h2>
          <div className="flex flex-wrap gap-3">
            {location.residents.map((r) => (
              <Link
                key={r.id}
                href={`/characters/${r.id}`}
                className="flex items-center gap-2 rounded-full border border-border-hairline pl-1 pr-3 py-1 hover:border-gold-500/40 transition-colors ease-premium"
              >
                <div className="relative h-7 w-7 rounded-full overflow-hidden shrink-0">
                  <Image
                    src={resolveImageSrc(r.image_url)}
                    alt={r.name}
                    fill
                    sizes="28px"
                    className="object-cover"
                  />
                </div>
                <span className="text-sm text-text-primary">{r.name}</span>
                {r.occupation && (
                  <span className="text-xs text-text-tertiary">· {r.occupation}</span>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}

      <WorldScenariosSection scenarios={scenarios} />

      {location.residents.length > 0 && (
        <section className="mt-8">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
            <Clapperboard className="h-3.5 w-3.5" /> Scene Builder
          </h2>
          <SceneStudio
            locationSlug={location.slug}
            residents={location.residents}
            factions={location.factions}
            initialScenes={location.scenes}
          />
        </section>
      )}
    </div>
  );
}

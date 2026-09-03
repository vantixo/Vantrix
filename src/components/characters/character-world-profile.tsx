"use client";

import { useEffect, useState } from "react";
import { SafeImage as Image } from "@/components/ui/safe-image";
import Link from "next/link";
import { AlertCircle, Award, Briefcase, Gem, ScrollText, Users2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { resolveImageSrc, formatDate } from "@/lib/utils";
import { useCharacterPage } from "@/hooks/use-character-page";
import type { CharacterWorldProfile } from "@/types/universe-views";

/**
 * Fronts GET /api/universe/profile — built (Aug 2026, Universe visual pass)
 * but never consumed by anything, per that route's own doc comment
 * ("Powers ... the chat insights panel's World Standing section") which
 * was aspirational, not actual. This is that consumer, added here rather
 * than only in the chat panel since a visitor evaluating a character
 * before ever starting a chat is the more natural place for it.
 */
export function CharacterWorldProfileSection({ characterId }: { characterId: string }) {
  const { getWorldProfile } = useCharacterPage();
  const [profile, setProfile] = useState<CharacterWorldProfile | undefined>(undefined);
  const [state, setState] = useState<"loading" | "ok" | "unauthorized" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    getWorldProfile(characterId).then((result) => {
      if (cancelled) return;
      if (result.status === "ok") {
        setProfile(result.data);
        setState("ok");
      } else {
        setState(result.status);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [characterId, getWorldProfile, attempt]);

  if (state === "loading") {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (state === "unauthorized") {
    return (
      <p className="py-10 text-center text-sm text-text-secondary">
        Sign in to see this character&apos;s standing in the world.
      </p>
    );
  }

  if (state === "error") {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <AlertCircle className="h-8 w-8 text-text-tertiary" />
        <p className="text-sm text-text-secondary">Couldn&apos;t load this character&apos;s world standing.</p>
        <button
          onClick={() => setAttempt((n) => n + 1)}
          className="text-xs text-gold-400 hover:text-gold-300"
        >
          Try again
        </button>
      </div>
    );
  }

  const p = profile as CharacterWorldProfile;
  const hasAnything =
    p.status || p.legend || p.attributes || p.reputation || p.occupation ||
    p.social_links.length > 0 || p.assets.length > 0 || p.biography.length > 0;

  if (!hasAnything) {
    return (
      <p className="py-10 text-center text-sm text-text-secondary">
        No world standing recorded for this character yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {(p.status || p.reputation) && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {p.status && <Badge variant="outline">{p.status.status_tier}</Badge>}
          {p.occupation?.occupation?.title && (
            <Badge variant="outline">
              <Briefcase className="h-3 w-3 mr-1" />
              {p.occupation.occupation.title} · {p.occupation.employer}
            </Badge>
          )}
        </div>
      )}

      {p.legend && (
        <div className="rounded-md border border-gold-500/25 bg-gold-500/5 p-4">
          <div className="flex items-center gap-2 mb-1.5">
            <Award className="h-4 w-4 text-gold-400" strokeWidth={1.75} />
            <span className="text-sm font-semibold text-text-primary">{p.legend.legend_title}</span>
          </div>
          <p className="text-sm text-text-secondary leading-relaxed">{p.legend.biography}</p>
        </div>
      )}

      {p.reputation && (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-md border border-border-hairline p-3 text-center">
            <div className="font-display text-xl text-text-primary tabular-nums">
              {p.reputation.fame_score}
            </div>
            <div className="text-xs uppercase tracking-wide text-text-secondary">Fame</div>
          </div>
          <div className="rounded-md border border-border-hairline p-3 text-center">
            <div className="font-display text-xl text-text-primary tabular-nums">
              {p.reputation.notoriety_score}
            </div>
            <div className="text-xs uppercase tracking-wide text-text-secondary">Notoriety</div>
          </div>
          {p.reputation.known_for.length > 0 && (
            <div className="col-span-2 flex flex-wrap justify-center gap-1.5">
              {p.reputation.known_for.map((k) => (
                <span
                  key={k}
                  className="rounded-full border border-border-hairline px-2.5 py-0.5 text-xs text-text-secondary"
                >
                  {k}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {p.attributes && (
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <div className="font-display text-lg text-text-primary tabular-nums">
              {p.attributes.health}
            </div>
            <div className="text-xs text-text-secondary">Health</div>
          </div>
          <div>
            <div className="font-display text-lg text-text-primary tabular-nums">
              {p.attributes.confidence}
            </div>
            <div className="text-xs text-text-secondary">Confidence</div>
          </div>
          <div>
            <div className="font-display text-lg text-text-primary tabular-nums capitalize">
              {p.attributes.wealth_tier}
            </div>
            <div className="text-xs text-text-secondary">Wealth</div>
          </div>
        </div>
      )}

      {p.social_links.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Users2 className="h-3.5 w-3.5 text-text-tertiary" />
            <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
              Connections
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {p.social_links.map((link) => (
              <Link
                key={link.id}
                href={`/characters/${link.linked_character_id}`}
                className="flex items-center gap-2 rounded-full border border-border-hairline pl-1 pr-3 py-1 hover:border-gold-500/40"
              >
                {link.linked_character?.image_url && (
                  <div className="relative h-6 w-6 shrink-0 rounded-full overflow-hidden">
                    <Image
                      src={resolveImageSrc(link.linked_character.image_url)}
                      alt={link.linked_character.name}
                      fill
                      sizes="24px"
                      className="object-cover"
                    />
                  </div>
                )}
                <span className="text-xs text-text-primary">
                  {link.linked_character?.name ?? "Unknown"}
                </span>
                <span className="text-xs text-text-tertiary">{link.link_type}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {p.assets.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Gem className="h-3.5 w-3.5 text-text-tertiary" />
            <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
              Held Artifacts
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {p.assets.map((asset) => (
              <div key={asset.id} className="rounded-md border border-border-hairline p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-primary font-medium">{asset.name}</span>
                  <Badge variant="outline">{asset.rarity}</Badge>
                </div>
                <p className="mt-1 text-xs text-text-secondary">{asset.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {p.biography.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <ScrollText className="h-3.5 w-3.5 text-text-tertiary" />
            <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
              Biography
            </span>
          </div>
          <div className="flex flex-col gap-3 border-l-2 border-border-hairline pl-3">
            {p.biography.map((entry, i) => (
              <div key={i}>
                <div className="text-xs text-text-tertiary">{formatDate(entry.occurred_at)}</div>
                <p className="text-sm text-text-primary">{entry.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

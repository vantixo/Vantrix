import Link from "next/link";
import { Compass, Heart, Sparkles, CalendarClock } from "lucide-react";
import type { DatingWorldHome } from "@/lib/frontend/dating";
import { getDatingWorldHome } from "@/lib/dating/get-world-home";
import { getAuthedUser } from "@/lib/auth/get-authed-user";
import { logger } from "@/lib/logger";
import { DATE_CATALOGUE } from "@/lib/dating/constants";
import { HorizontalScrollRow } from "@/components/ui/horizontal-scroll-row";
import { Button } from "@/components/ui/button";
import { UnavailableState } from "@/components/ui/unavailable-state";
import { TonightMatchCard } from "@/components/dating/tonight-match-card";
import { LockedTonightMatchCard } from "@/components/dating/locked-tonight-match-card";
import { CandidateCard } from "@/components/dating/candidate-card";
import { WorldRelationshipCard } from "@/components/dating/world-relationship-card";

export const dynamic = "force-dynamic";

function dateLabel(type: string) {
  return DATE_CATALOGUE.find((d) => d.type === type);
}

/**
 * "Your World" — the actual Dating-tab landing surface per the frontend
 * directive's route map (§11: dating/world → "Dating tab (mobile
 * bottom-tab equivalent)"), composing GET /api/dating/world. Discovery /
 * swiping moved to /dating/deck as one action launched from here rather
 * than being the only thing this tab does.
 */
export default async function DatingWorldPage() {
  // ROOT-CAUSE FIX (2026-08-23): this page used to call getWorldHome(),
  // which round-tripped through fetchInternal() -> an HTTP self-fetch back
  // to this same Next.js process. That self-fetch — not the URL-building
  // logic inside it, which had already been patched twice — was the actual
  // source of the repeated "fetchInternal: /api/dating/world responded
  // 404" failures (see lib/dating/get-world-home.ts's header comment for
  // the full explanation). This page now calls the same aggregation logic
  // in-process: no network hop, nothing that can 404. The API route at
  // GET /api/dating/world still exists, calling the same shared function,
  // for any client-side/external caller.
  let world: DatingWorldHome;
  try {
    const { user } = await getAuthedUser();
    if (!user) {
      // The (app) layout already redirects signed-out visitors away from
      // every route in this group, so this is a defensive fallback, not
      // the expected path — treat it the same as any other unavailable
      // state rather than crashing.
      throw new Error('no authenticated user');
    }
    world = await getDatingWorldHome(user.id);
  } catch (error) {
    // Previously a bare `catch {}` — the real failure reason was discarded
    // with nothing printed anywhere, so this state was undebuggable from
    // server logs. Now it's actually visible.
    logger.error('dating-world-page:fetch-failed', { error: String(error) });
    return (
      <div className="mx-auto max-w-4xl px-4 md:px-8 py-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="font-display text-xl text-text-primary">Your World</h1>
        </div>
        <UnavailableState message="Your world is temporarily unavailable — try again in a moment." />
      </div>
    );
  }

  const hasAnything =
    world.relationships.length > 0 ||
    world.recommended.length > 0 ||
    world.tonightsMatch !== null;

  return (
    <div className="mx-auto max-w-4xl px-4 md:px-8 py-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-xl text-text-primary">Your World</h1>
        <div className="flex items-center gap-3">
          <Link
            href="/dating/matches"
            className="text-sm font-medium text-text-secondary hover:text-text-primary"
          >
            Matches
          </Link>
          <Button size="sm" asChild>
            <Link href="/dating/deck">
              <Compass className="h-4 w-4" />
              Discover
            </Link>
          </Button>
        </div>
      </div>

      {!hasAnything && (
        <div className="flex flex-col items-center gap-3 rounded-md border border-border-hairline py-16 text-center">
          <Heart className="h-10 w-10 text-text-tertiary" />
          <p className="text-text-secondary">Your world is quiet for now.</p>
          <Button size="sm" asChild>
            <Link href="/dating/deck">Start Discovering</Link>
          </Button>
        </div>
      )}

      {world.tonightsMatch && (
        // RETENTION-01: free users get a locked teaser (blurred photo/name
        // + upgrade CTA) for the exact same daily-pinned match a premium
        // user sees fully revealed — see LockedTonightMatchCard's header
        // comment and get-world-home.ts's isPremium comment.
        world.isPremium ? (
          <TonightMatchCard
            candidate={world.tonightsMatch}
            eyebrow="Tonight's Match"
            className="mb-4"
          />
        ) : (
          <LockedTonightMatchCard candidate={world.tonightsMatch} className="mb-4" />
        )
      )}

      {world.unexpectedChemistry && (
        <TonightMatchCard
          candidate={world.unexpectedChemistry}
          eyebrow="Unexpected Chemistry"
          className="mb-6"
        />
      )}

      {world.relationships.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold text-text-primary">Your Relationships</h2>
          <HorizontalScrollRow>
            {world.relationships.map((r) => (
              <WorldRelationshipCard key={r.id} relationship={r} />
            ))}
          </HorizontalScrollRow>
        </section>
      )}

      {(world.dates.active.length > 0 || world.dates.recent.length > 0) && (
        <section className="mb-8">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-primary">
            <CalendarClock className="h-4 w-4 text-gold-400" />
            Dates
          </h2>
          <div className="flex flex-col gap-2">
            {world.dates.active.map((d) => {
              const info = dateLabel(d.date_type);
              return (
                <Link
                  key={d.id}
                  href={`/dating/match/${d.match_id}`}
                  className="flex items-center gap-3 rounded-sm border border-gold-500/40 bg-gold-500/5 px-3 py-2 text-sm"
                >
                  <span className="text-lg">{info?.emoji ?? "\u2728"}</span>
                  <span className="text-text-primary">
                    {info?.name ?? d.date_type} with {d.character?.name ?? "someone"}
                  </span>
                  <span className="ml-auto text-xs font-semibold text-gold-400">In progress</span>
                </Link>
              );
            })}
            {world.dates.recent.map((d) => {
              const info = dateLabel(d.date_type);
              return (
                <Link
                  key={d.id}
                  href={`/dating/match/${d.match_id}`}
                  className="flex items-center gap-3 rounded-sm border border-border-hairline px-3 py-2 text-sm"
                >
                  <span className="text-lg">{info?.emoji ?? "\u2728"}</span>
                  <span className="text-text-primary">
                    {info?.name ?? d.date_type} with {d.character?.name ?? "someone"}
                  </span>
                  <span className="ml-auto text-xs text-text-tertiary">
                    {d.completed_at ? new Date(d.completed_at).toLocaleDateString() : ""}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {world.recentMoments.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-primary">
            <Sparkles className="h-4 w-4 text-gold-400" />
            Recent Moments
          </h2>
          <div className="flex flex-col gap-2">
            {world.recentMoments.map((m) => (
              <div
                key={m.id}
                className="flex items-center gap-3 rounded-sm border border-border-hairline px-3 py-2 text-sm"
              >
                <span className="text-text-primary">{m.title}</span>
                {m.character?.name && (
                  <span className="text-text-secondary">· {m.character.name}</span>
                )}
                <span className="ml-auto shrink-0 text-xs text-text-tertiary">
                  {new Date(m.created_at).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {world.recommended.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text-primary">Recommended For You</h2>
            <Link
              href="/dating/deck"
              className="text-sm font-medium text-gold-400 hover:text-gold-300"
            >
              View All
            </Link>
          </div>
          <HorizontalScrollRow>
            {world.recommended.map((c) => (
              <CandidateCard key={c.id} candidate={c} />
            ))}
          </HorizontalScrollRow>
        </section>
      )}
    </div>
  );
}

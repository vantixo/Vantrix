import { Globe2 } from "lucide-react";
import { getWorldHub } from "@/lib/frontend/world";
import { WorldStateBanner } from "@/components/world/world-state-banner";
import { WorldEventItem, WorldStoryItem } from "@/components/world/world-event-story-items";
import { LocationCard, FactionCard } from "@/components/world/world-cards";
import { GovernancePanel } from "@/components/world/governance-panel";
import { LegendsPanel } from "@/components/world/legends-panel";
import { StatusPanel } from "@/components/world/status-panel";
import { DailyChoiceCard } from "@/components/world/daily-choice-card";
import { TitlesPanel } from "@/components/world/titles-panel";
import { ArtifactsPanel } from "@/components/world/artifacts-panel";
import { HistoryPanel } from "@/components/world/history-panel";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export const dynamic = "force-dynamic";

/**
 * §11: universe/world, /locations, /factions -> World page (§12 Phase 5).
 * One page, three tabs, rather than three routes — the directive's page
 * inventory (§3) never specified separate URLs for this section, and all
 * three data sets come back from one getWorldHub() call, so splitting
 * them into distinct pages would just mean three server round trips for
 * data already sitting in one payload.
 *
 * AMENDMENT (§12 phase 5 gap pass): added a fourth Governance tab.
 * elections/*, laws/* had a full backend (campaigning/voting engine,
 * vote cast/retract, results) with zero consuming UI — Locations only
 * showed read-only governance stats (approval/stability), never an
 * actual ballot. This tab is fetched client-side (GovernancePanel)
 * rather than folded into getWorldHub(), since votes are per-user
 * mutable state, not the mostly-static overview/locations/factions data.
 *
 * AMENDMENT 2: added Legends, Titles, Artifacts, History tabs, copying
 * the Governance tab's self-contained client-fetch pattern four more
 * times. All four backends (status-legend.ts, reputation-titles.ts,
 * scarcity.ts, world-history.ts) were fully built with matching
 * TypeScript types already defined and zero consuming UI anywhere in
 * the app. Each stays read-only (no per-user mutation like governance's
 * votes), so each panel is a plain fetch-on-mount rather than needing
 * useGovernance's imperative vote/retract actions.
 *
 * AMENDMENT 3: added the Daily World Choice card to Overview (voting
 * mutation, same shape as Governance's vote action) and a Status tab
 * (leaderboard, read-only, same shape as Legends). Both routes
 * (/api/universe/daily-choice, /api/universe/status) had complete
 * backends with zero consumer. Status intentionally sits as its own
 * tab rather than folded into Legends — different data source
 * (status-legend.ts's leaderboard, not the scarcity-capped legends
 * list) and a different question ("who's rising" vs. "who's already
 * legendary").
 */
export default async function WorldPage() {
  const { overview, locations, factions } = await getWorldHub();

  return (
    <div className="mx-auto max-w-7xl px-4 md:px-8 py-6">
      <div className="flex items-center gap-2 mb-4">
        <Globe2 className="h-5 w-5 text-gold-500" strokeWidth={1.75} />
        <h1 className="font-display text-2xl text-text-primary">World</h1>
      </div>

      <WorldStateBanner state={overview.state} />

      <Tabs defaultValue="overview" className="mt-6">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="locations">Locations ({locations.length})</TabsTrigger>
          <TabsTrigger value="factions">Factions ({factions.length})</TabsTrigger>
          <TabsTrigger value="governance">Governance</TabsTrigger>
          <TabsTrigger value="legends">Legends</TabsTrigger>
          <TabsTrigger value="status">Status</TabsTrigger>
          <TabsTrigger value="titles">Titles</TabsTrigger>
          <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="pt-6 space-y-8">
          <section>
            <DailyChoiceCard />
          </section>

          <section>
            <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
              Active Events
            </h2>
            {overview.events.length === 0 ? (
              <p className="text-sm text-text-tertiary">No active events right now.</p>
            ) : (
              <div className="grid sm:grid-cols-2 gap-3">
                {overview.events.map((e) => (
                  <WorldEventItem key={e.id} event={e} />
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
              Ongoing Stories
            </h2>
            {overview.stories.length === 0 ? (
              <p className="text-sm text-text-tertiary">No stories in motion right now.</p>
            ) : (
              <div className="grid sm:grid-cols-2 gap-3">
                {overview.stories.map((s) => (
                  <WorldStoryItem key={s.id} story={s} />
                ))}
              </div>
            )}
          </section>
        </TabsContent>

        <TabsContent value="locations" className="pt-6">
          {locations.length === 0 ? (
            <p className="text-sm text-text-tertiary">No locations discovered yet.</p>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {locations.map((l) => (
                <LocationCard key={l.id} location={l} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="factions" className="pt-6">
          {factions.length === 0 ? (
            <p className="text-sm text-text-tertiary">No factions have formed yet.</p>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {factions.map((f) => (
                <FactionCard key={f.id} faction={f} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="governance" className="pt-6">
          <GovernancePanel />
        </TabsContent>

        <TabsContent value="legends" className="pt-6">
          <LegendsPanel />
        </TabsContent>

        <TabsContent value="status" className="pt-6">
          <StatusPanel />
        </TabsContent>

        <TabsContent value="titles" className="pt-6">
          <TitlesPanel />
        </TabsContent>

        <TabsContent value="artifacts" className="pt-6">
          <ArtifactsPanel />
        </TabsContent>

        <TabsContent value="history" className="pt-6">
          <HistoryPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

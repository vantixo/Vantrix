import Link from "next/link";
import { Plus, Sparkles } from "lucide-react";
import { getMyCharacters, getMarketLeaderboard } from "@/lib/frontend/studio";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MyCharacterRow, MarketCharacterCard } from "@/components/studio/studio-cards";
import { ImportCharacterButton } from "@/components/studio/import-character-button";

export const dynamic = "force-dynamic";

/**
 * §11 Studio surface: characters/mine (creation/training status) +
 * characters/market (rarity leaderboard). Full LoRA training/animate/
 * import/export tooling (§11's other Studio-mapped routes) stays out of
 * this pass — those are per-character operations best surfaced from the
 * character's own detail/edit view once one exists, not the hub; this
 * hub covers what §12 Phase 8 actually needs: see your characters,
 * create a new one, browse the leaderboard.
 */
export default async function StudioPage() {
  const [mine, market] = await Promise.all([
    getMyCharacters(),
    getMarketLeaderboard(),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-4 md:px-8 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-2xl text-text-primary">Studio</h1>
        <div className="flex items-center gap-2">
          <ImportCharacterButton />
          <Button asChild>
            <Link href="/studio/create">
              <Plus className="h-4 w-4" /> Create Character
            </Link>
          </Button>
        </div>
      </div>

      <Tabs defaultValue="mine">
        <TabsList>
          <TabsTrigger value="mine">My Characters ({mine.length})</TabsTrigger>
          <TabsTrigger value="market">Market</TabsTrigger>
        </TabsList>

        <TabsContent value="mine" className="pt-6">
          {mine.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <Sparkles className="h-10 w-10 text-text-tertiary" />
              <p className="text-text-secondary">
                You haven&rsquo;t created a companion yet.
              </p>
              <Link href="/studio/create" className="text-gold-400 hover:text-gold-300 text-sm font-medium">
                Create your first one
              </Link>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {mine.map((c) => (
                <MyCharacterRow key={c.id} character={c} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="market" className="pt-6">
          {market.length === 0 ? (
            <p className="text-sm text-text-tertiary text-center py-16">
              No market rankings yet.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {market.map((c, i) => (
                <MarketCharacterCard key={c.character_id} character={c} rank={i + 1} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

import Link from "next/link";
import { Heart } from "lucide-react";
import { getDatingMatches, type DatingMatch } from "@/lib/frontend/dating";
import { logger } from "@/lib/logger";
import { MatchCard } from "@/components/dating/match-card";
import { UnavailableState } from "@/components/ui/unavailable-state";

export const dynamic = "force-dynamic";

export default async function DatingMatchesPage() {
  // UX AUDIT FIX (item 3): getDatingMatches() has no internal try/catch
  // (see lib/frontend/dating.ts), so a fetch failure previously rendered
  // identically to "no matches yet" — this now tells those two apart.
  let matches: DatingMatch[];
  let unavailable = false;
  try {
    matches = await getDatingMatches();
  } catch (error) {
    // Same silent-catch gap as /dating — see that page's comment.
    logger.error('dating-matches-page:fetch-failed', { error: String(error) });
    matches = [];
    unavailable = true;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 md:px-8 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-xl text-text-primary">Your Matches</h1>
        <Link href="/dating/deck" className="text-sm font-medium text-gold-400 hover:text-gold-300">
          Keep Swiping
        </Link>
      </div>

      {unavailable ? (
        <UnavailableState message="Your matches are temporarily unavailable — try again in a moment." />
      ) : matches.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Heart className="h-10 w-10 text-text-tertiary" />
          <p className="text-text-secondary">No matches yet.</p>
          <Link href="/dating/deck" className="text-sm font-medium text-gold-400 hover:text-gold-300">
            Start swiping
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {matches.map((m) => (
            <MatchCard key={m.id} match={m} />
          ))}
        </div>
      )}
    </div>
  );
}

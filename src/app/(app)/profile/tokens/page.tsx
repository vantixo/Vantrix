import { Coins } from "lucide-react";
import { TOKEN_PACKS } from "@/lib/frontend/premium";
import { getShellSession } from "@/lib/frontend/session";
import { TokenPackCard } from "@/components/premium/token-pack-card";

export const dynamic = "force-dynamic";

/**
 * The account menu's Tokens row (account-menu.tsx) already links here —
 * this route was the one 404 in that menu. It doubles as the purchase
 * UI token-packs.ts's own doc comment points to
 * (`src/app/(main)/store/page.tsx`) from before the `(main)` route
 * group was replaced by `(app)`; rather than reviving a second route at
 * `/store`, checkout-tokens/route.ts's successUrl/cancelUrl were
 * repointed to this path (see that file) so there's exactly one token
 * purchase surface, matching where users already look for it.
 */
export default async function TokensPage() {
  const session = await getShellSession();
  const tokens = session?.profile.tokens ?? 0;

  return (
    <div className="mx-auto max-w-4xl px-4 md:px-8 py-10">
      <div className="text-center">
        <div className="h-14 w-14 mx-auto rounded-full border border-gold-500/50 flex items-center justify-center">
          <Coins className="h-6 w-6 text-gold-500" strokeWidth={1.75} />
        </div>
        <h1 className="font-display text-2xl text-text-primary mt-4">
          Vantrix Coin
        </h1>
        <p className="text-text-secondary mt-1">
          Your balance:{" "}
          <span className="text-gold-400 font-semibold tabular-nums">
            {tokens.toLocaleString()}
          </span>
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-8">
        {TOKEN_PACKS.map((pack) => (
          <TokenPackCard key={pack.id} pack={pack} />
        ))}
      </div>
    </div>
  );
}

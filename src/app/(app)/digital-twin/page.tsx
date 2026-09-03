import { Bot } from "lucide-react";
import { getTwinPageData } from "@/lib/frontend/digital-twin";
import { getShellSession } from "@/lib/frontend/session";
import { TRAINING_TOKEN_COST, TRAINING_ETA_SECONDS } from "@/lib/digital-twin/engine";
import { TwinConsole } from "@/components/digital-twin/twin-console";
import { TwinGatedNotice } from "@/components/digital-twin/gated-notice";

export const dynamic = "force-dynamic";

/**
 * Frontend gap fix — /api/digital-twin, /chat, /train, /history, /export
 * shipped with a full moderation-free, token-metered, rate-limited engine
 * (src/lib/digital-twin/engine.ts) and zero consuming page. Reachable from
 * the Sidebar/MobileDrawer account footer (see shell/sidebar.tsx's
 * ACCOUNT-ROW-EXPANSION comment) rather than primary nav — this is a
 * premium-gated personal feature, not core IA, same reasoning as
 * Tokens/Settings living there instead of the main list.
 */
export default async function DigitalTwinPage() {
  const [{ gated, profile }, session] = await Promise.all([
    getTwinPageData(),
    getShellSession(),
  ]);

  return (
    <div className="mx-auto max-w-2xl px-4 md:px-8 py-6">
      <div className="flex items-center gap-2 mb-1">
        <Bot className="h-5 w-5 text-gold-500" strokeWidth={1.75} />
        <h1 className="font-display text-2xl text-text-primary">Digital Twin</h1>
      </div>
      <p className="text-text-secondary text-sm mb-6">
        An AI clone of your own texting style, trained on how you actually write.
      </p>

      {gated ? (
        <TwinGatedNotice />
      ) : (
        <TwinConsole
          initialProfile={profile}
          trainingCosts={TRAINING_TOKEN_COST}
          trainingEtas={TRAINING_ETA_SECONDS}
          tokens={session?.profile.tokens ?? 0}
        />
      )}
    </div>
  );
}

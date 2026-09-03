"use client";

import { useState } from "react";
import { FilterPillGroup } from "@/components/ui/filter-pills";
import { CrisisEventsPanel } from "@/components/admin/safety/crisis-events-panel";
import { AbuseSignalsPanel } from "@/components/admin/safety/abuse-signals-panel";
import { ReplyGuardPanel } from "@/components/admin/safety/reply-guard-panel";
import { UserReportsPanel } from "@/components/admin/safety/user-reports-panel";
import { KeywordWatchHitsPanel } from "@/components/admin/safety/keyword-watch-hits-panel";
import { KeywordWatchlistManager } from "@/components/admin/safety/keyword-watchlist-manager";
import { RevocationFlagsPanel } from "@/components/admin/safety/revocation-flags-panel";
import { SuspensionLookup } from "@/components/admin/safety/suspension-lookup";

const TABS = [
  { value: "crisis", label: "Crisis Events" },
  { value: "abuse", label: "Abuse Signals" },
  { value: "reply-guard", label: "Reply Guard" },
  { value: "reports", label: "User Reports" },
  { value: "keywords", label: "Keyword Watch" },
  { value: "revocation", label: "Revocations" },
  { value: "suspensions", label: "Suspensions" },
];

export default function TrustSafetyPage() {
  const [tab, setTab] = useState("crisis");

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-16">
      <div>
        <h2 className="font-display text-2xl mb-1">Trust & Safety</h2>
        <p className="text-text-secondary text-sm">
          Every queue here is a non-blocking review — the underlying action
          (crisis reply, blocked message, bot signal) already happened
          automatically; this is where a human confirms or corrects it.
        </p>
      </div>

      <FilterPillGroup options={TABS} value={tab} onChange={setTab} />

      <div>
        {tab === "crisis" && <CrisisEventsPanel />}
        {tab === "abuse" && <AbuseSignalsPanel />}
        {tab === "reply-guard" && <ReplyGuardPanel />}
        {tab === "reports" && <UserReportsPanel />}
        {tab === "keywords" && (
          <div className="space-y-8">
            <section>
              <h3 className="font-display text-lg mb-3">Watched Keywords</h3>
              <KeywordWatchlistManager />
            </section>
            <section>
              <h3 className="font-display text-lg mb-3">Recent Hits</h3>
              <KeywordWatchHitsPanel />
            </section>
          </div>
        )}
        {tab === "revocation" && <RevocationFlagsPanel />}
        {tab === "suspensions" && <SuspensionLookup />}
      </div>
    </div>
  );
}

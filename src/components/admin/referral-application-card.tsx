"use client";

import { useState } from "react";
import { Check, X, Loader2, ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RevealItem } from "@/components/admin/motion/reveal";
import { decideReferralApplication, type ReferralApplication } from "@/lib/frontend/admin-referrals";

export function ReferralApplicationCard({
  app,
  onResolved,
}: {
  app: ReferralApplication;
  onResolved: (id: string) => void;
}) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "approve" | "reject") {
    setBusy(decision === "approve" ? "approve" : "reject");
    setError(null);
    try {
      await decideReferralApplication(app.id, decision, decision === "reject" ? reason : undefined);
      onResolved(app.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
      setBusy(null);
    }
  }

  return (
    <RevealItem>
      <Card interactive={false} className="p-4">
        <div className="flex items-center justify-between gap-3 mb-2">
          <p className="font-medium text-text-primary">{app.applicantName}</p>
          <span className="text-xs uppercase tracking-wide text-gold-500 font-semibold">
            {app.class}
          </span>
        </div>
        <p className="text-xs text-text-tertiary mb-3">
          Code: <span className="font-mono">{app.code}</span>
          {app.follower_count != null && ` · ${app.follower_count.toLocaleString()} followers`}
        </p>

        {app.application_note && (
          <p className="text-sm text-text-secondary mb-2">{app.application_note}</p>
        )}
        {app.social_proof_url && (
          <a
            href={app.social_proof_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-gold-400 hover:text-gold-300 mb-3"
          >
            Social proof <ExternalLink className="h-3 w-3" />
          </a>
        )}

        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Rejection reason (if rejecting)"
          className="w-full h-9 px-3 mb-3 rounded-sm bg-base border border-border-hairline text-sm text-text-primary placeholder:text-text-tertiary focus:border-gold-500/60 outline-none"
        />

        {error && <p className="text-sm text-danger mb-2">{error}</p>}

        <div className="flex gap-2">
          <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => decide("approve")}>
            {busy === "approve" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Approve
          </Button>
          <Button size="sm" variant="destructive" disabled={busy !== null} onClick={() => decide("reject")}>
            {busy === "reject" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
            Reject
          </Button>
        </div>
      </Card>
    </RevealItem>
  );
}

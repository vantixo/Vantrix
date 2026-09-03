"use client";

import { ReviewQueue } from "./review-queue";
import {
  fetchAbuseSignals,
  reviewAbuseSignal,
  type AbuseSignal,
} from "@/lib/frontend/admin-safety";

export function AbuseSignalsPanel() {
  return (
    <ReviewQueue<AbuseSignal>
      fetcher={fetchAbuseSignals}
      onReview={reviewAbuseSignal}
      withNotes
      emptyLabel="No pending abuse signals."
      actions={[
        { label: "Confirm Bot", status: "confirmed_bot", variant: "destructive" },
        { label: "Confirm Human", status: "confirmed_human", variant: "primary" },
        { label: "Dismiss", status: "dismissed", variant: "ghost" },
      ]}
      renderMeta={(s) => (
        <span className="text-xs font-semibold text-gold-400">
          Score {s.score}/100 · {s.kind}
        </span>
      )}
      renderBody={(s) => (
        <div>
          <p className="text-text-secondary text-xs mb-1">{s.path}</p>
          <p className="text-xs text-text-tertiary">
            {s.reasons.join(" · ")}
          </p>
        </div>
      )}
    />
  );
}

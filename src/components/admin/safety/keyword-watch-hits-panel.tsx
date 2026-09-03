"use client";

import { ReviewQueue } from "./review-queue";
import {
  fetchKeywordWatchHits,
  reviewKeywordWatchHit,
  type KeywordWatchHit,
} from "@/lib/frontend/admin-safety";

export function KeywordWatchHitsPanel() {
  return (
    <ReviewQueue<KeywordWatchHit>
      fetcher={fetchKeywordWatchHits}
      onReview={reviewKeywordWatchHit}
      emptyLabel="No pending keyword hits."
      actions={[
        { label: "Reviewed", status: "reviewed", variant: "primary" },
        { label: "Dismiss", status: "dismissed", variant: "ghost" },
      ]}
      renderMeta={(h) => (
        <span className="text-xs font-semibold text-gold-400">
          &ldquo;{h.keyword_text}&rdquo; · {h.direction === "user_message" ? "User" : "Character"}
        </span>
      )}
      renderBody={(h) => (
        <p className="whitespace-pre-wrap border-l-2 border-gold-500/30 pl-3">
          {h.excerpt}
        </p>
      )}
    />
  );
}

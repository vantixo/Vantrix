"use client";

import { ReviewQueue } from "./review-queue";
import {
  fetchReplyGuardFlags,
  reviewReplyGuardFlag,
  type ReplyGuardFlag,
} from "@/lib/frontend/admin-safety";

export function ReplyGuardPanel() {
  return (
    <ReviewQueue<ReplyGuardFlag>
      fetcher={fetchReplyGuardFlags}
      onReview={reviewReplyGuardFlag}
      emptyLabel="No pending reply-guard flags."
      actions={[
        { label: "Confirmed", status: "reviewed", variant: "primary" },
        { label: "False Positive", status: "false_positive", variant: "ghost" },
      ]}
      renderMeta={(f) => (
        <span className="text-xs font-semibold text-gold-400 capitalize">
          {f.category}
        </span>
      )}
      renderBody={(f) => (
        <p className="whitespace-pre-wrap border-l-2 border-gold-500/30 pl-3">
          &ldquo;{f.blocked_excerpt}&rdquo;
        </p>
      )}
    />
  );
}

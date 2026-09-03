"use client";

import { AlertOctagon } from "lucide-react";
import { ReviewQueue } from "./review-queue";
import {
  fetchCrisisEvents,
  reviewCrisisEvent,
  type CrisisEvent,
} from "@/lib/frontend/admin-safety";

const CATEGORY_LABEL: Record<string, string> = {
  suicidal_ideation: "Suicidal Ideation",
  self_harm_intent: "Self-Harm Intent",
  hopelessness_severe: "Severe Hopelessness",
};

export function CrisisEventsPanel() {
  return (
    <ReviewQueue<CrisisEvent>
      fetcher={fetchCrisisEvents}
      onReview={reviewCrisisEvent}
      withNotes
      emptyLabel="No pending crisis signals."
      actions={[
        { label: "Followed Up", status: "reviewed_followed_up", variant: "primary" },
        { label: "No Action Needed", status: "reviewed_no_action" },
        { label: "False Positive", status: "false_positive", variant: "ghost" },
      ]}
      renderMeta={(e) => (
        <span className="flex items-center gap-1.5 text-xs font-semibold text-danger">
          <AlertOctagon className="h-3.5 w-3.5" />
          {CATEGORY_LABEL[e.category] ?? e.category}
        </span>
      )}
      renderBody={(e) => (
        <p className="whitespace-pre-wrap border-l-2 border-danger/40 pl-3">
          &ldquo;{e.message_excerpt}&rdquo;
        </p>
      )}
    />
  );
}

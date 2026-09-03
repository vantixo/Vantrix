"use client";

import { Flag, MessageSquare, MessagesSquare } from "lucide-react";
import { ReviewQueue } from "./review-queue";
import {
  fetchUserReports,
  reviewUserReport,
  type UserReport,
} from "@/lib/frontend/admin-safety";
import { CATEGORY_LABELS } from "@/lib/reporting/categories";

const HIGH_PRIORITY = new Set(["underage_content", "harmful_ai_output"]);

function targetLabel(r: UserReport): string {
  if (r.community_post_id) return "Community post";
  if (r.community_reply_id) return "Community reply";
  if (r.conversation_id) return "Conversation";
  if (r.character_id) return "Character";
  if (r.match_id) return "Match";
  return "Unknown target";
}

export function UserReportsPanel() {
  return (
    <ReviewQueue<UserReport>
      fetcher={fetchUserReports}
      onReview={reviewUserReport}
      emptyLabel="No pending reports."
      actions={[
        { label: "Actioned", status: "actioned", variant: "primary" },
        { label: "Reviewed", status: "reviewed" },
        { label: "Dismiss", status: "dismissed", variant: "ghost" },
      ]}
      renderMeta={(r) => (
        <span
          className={
            "flex items-center gap-1.5 text-xs font-semibold " +
            (HIGH_PRIORITY.has(r.category) ? "text-danger" : "text-text-secondary")
          }
        >
          <Flag className="h-3.5 w-3.5" />
          {CATEGORY_LABELS[r.category as keyof typeof CATEGORY_LABELS] ?? r.category}
        </span>
      )}
      renderBody={(r) => (
        <div>
          <div className="flex items-center gap-1.5 text-xs text-text-tertiary mb-1.5">
            {r.community_post_id || r.community_reply_id ? (
              <MessagesSquare className="h-3.5 w-3.5" />
            ) : (
              <MessageSquare className="h-3.5 w-3.5" />
            )}
            {targetLabel(r)}
          </div>
          {r.message_snippet && (
            <p className="whitespace-pre-wrap border-l-2 border-border-hairline pl-3 mb-1.5">
              &ldquo;{r.message_snippet}&rdquo;
            </p>
          )}
          {r.detail && <p className="text-text-secondary">{r.detail}</p>}
        </div>
      )}
    />
  );
}

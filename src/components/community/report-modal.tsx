"use client";

import { useState } from "react";
import { Flag, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCommunity } from "@/hooks/use-community";
import { COMMUNITY_REPORT_CATEGORIES, CATEGORY_LABELS, type ReportCategory } from "@/lib/reporting/categories";

/**
 * Report entry point for community posts/replies. There was previously no
 * report UI anywhere in the app — /api/report existed but nothing called
 * it for community content. Overlay structure mirrors gift-drawer.tsx
 * (the app's one existing bottom-sheet-on-mobile / centered-on-desktop
 * modal pattern) since there's no shared Dialog primitive in components/ui
 * to build on yet.
 */
export function ReportModal({
  communityPostId,
  communityReplyId,
  triggerClassName,
}: {
  communityPostId?: string;
  communityReplyId?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [detail, setDetail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const { reportContent } = useCommunity();

  function close() {
    setOpen(false);
    // Reset after the close animation would run, so a re-open starts fresh
    // rather than showing a stale "Reported" state.
    setTimeout(() => {
      setCategory(null);
      setDetail("");
      setError(null);
      setDone(false);
    }, 200);
  }

  async function handleSubmit() {
    if (!category || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await reportContent({ communityPostId, communityReplyId, category, detail: detail.trim() || undefined });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't submit report.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Report"
        className={cn(
          "flex items-center gap-1 text-text-tertiary hover:text-danger transition-colors ease-premium",
          triggerClassName
        )}
      >
        <Flag className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center">
          <div className="max-h-[85dvh] w-full max-w-sm overflow-y-auto rounded-t-lg border border-border-hairline bg-base p-4 sm:rounded-lg">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-base text-text-primary">
                {communityReplyId ? "Report reply" : "Report post"}
              </h2>
              <button onClick={close} aria-label="Close" className="text-text-secondary hover:text-text-primary">
                <X className="h-5 w-5" />
              </button>
            </div>

            {done ? (
              <div className="py-6 text-center">
                <p className="text-sm text-text-primary">
                  Thanks — your report has been submitted. Our team reviews all reports.
                </p>
                <Button size="sm" variant="secondary" className="mt-4" onClick={close}>
                  Close
                </Button>
              </div>
            ) : (
              <>
                <p className="text-text-secondary text-sm mb-3">
                  Why are you reporting this?
                </p>

                <div className="flex flex-col gap-1.5 mb-3">
                  {COMMUNITY_REPORT_CATEGORIES.map((c) => (
                    <button
                      key={c}
                      onClick={() => setCategory(c)}
                      className={cn(
                        "text-left text-sm px-3 py-2 rounded-sm border transition-colors ease-premium",
                        category === c
                          ? "border-gold-500/60 text-gold-300 bg-gold-500/5"
                          : "border-border-hairline text-text-primary hover:border-interactive"
                      )}
                    >
                      {CATEGORY_LABELS[c]}
                    </button>
                  ))}
                </div>

                <textarea
                  value={detail}
                  onChange={(e) => setDetail(e.target.value)}
                  maxLength={500}
                  rows={2}
                  placeholder="Additional details (optional)"
                  className="w-full rounded-sm bg-base border border-interactive px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-gold-500/60 resize-none mb-3"
                />

                {error && <p className="text-sm text-danger mb-3">{error}</p>}

                <Button
                  size="sm"
                  variant="primary"
                  disabled={!category || submitting}
                  onClick={handleSubmit}
                  className="w-full"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit report"}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

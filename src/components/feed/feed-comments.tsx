"use client";

import { useEffect, useState } from "react";
import { SafeImage as Image } from "@/components/ui/safe-image";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resolveImageSrc, timeAgo, cn } from "@/lib/utils";
import { useFeed } from "@/hooks/use-feed";
import type { FeedComment } from "@/types/feed";

const inputClass =
  "w-full rounded-sm bg-base border border-interactive px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-gold-500/60";

export function FeedComments({
  postId,
  onCommentAdded,
}: {
  postId: string;
  onCommentAdded: () => void;
}) {
  const { fetchComments, submitComment } = useFeed();
  const [comments, setComments] = useState<FeedComment[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchComments(postId).then((page) => {
      if (cancelled) return;
      setComments(page?.comments ?? []);
      setNextCursor(page?.nextCursor ?? null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    const page = await fetchComments(postId, nextCursor);
    if (page) {
      setComments((prev) => [...(prev ?? []), ...page.comments]);
      setNextCursor(page.nextCursor);
    }
    setLoadingMore(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (!content || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const comment = await submitComment(postId, content);
      setComments((prev) => [
        { ...comment, author: { type: "user" as const, id: "", name: "You", image_url: null } },
        ...(prev ?? []),
      ]);
      setDraft("");
      onCommentAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't post comment.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="border-t border-border-hairline px-4 py-3">
      <form onSubmit={handleSubmit} className="flex items-center gap-2 mb-3">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a comment…"
          maxLength={500}
          className={cn(inputClass, "h-9")}
          disabled={submitting}
        />
        <Button type="submit" size="icon" variant="ghost" disabled={!draft.trim() || submitting}>
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </form>
      {error && <p className="text-xs text-danger mb-2">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-text-tertiary" />
        </div>
      ) : comments && comments.length > 0 ? (
        <div className="flex flex-col gap-3">
          {comments.map((c) => (
            <div key={c.id} className="flex items-start gap-2.5">
              <div className="relative h-7 w-7 shrink-0 rounded-full overflow-hidden border border-border-hairline">
                <Image
                  src={resolveImageSrc(c.author.image_url)}
                  alt={c.author.name ?? "User"}
                  fill
                  sizes="28px"
                  className="object-cover"
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <span
                    className={cn(
                      "text-xs font-semibold",
                      c.author.type === "character" ? "text-gold-400" : "text-text-primary"
                    )}
                  >
                    {c.author.name ?? "Someone"}
                  </span>
                  <span className="text-[11px] text-text-tertiary">{timeAgo(c.created_at)}</span>
                </div>
                <p className="text-sm text-text-secondary break-words">{c.content}</p>
              </div>
            </div>
          ))}
          {nextCursor && (
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="text-xs text-text-tertiary hover:text-text-secondary self-start"
            >
              {loadingMore ? "Loading…" : "View more comments"}
            </button>
          )}
        </div>
      ) : (
        <p className="text-xs text-text-tertiary py-2">No comments yet. Say something.</p>
      )}
    </div>
  );
}

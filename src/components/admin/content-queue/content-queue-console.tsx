"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FilterPillGroup } from "@/components/ui/filter-pills";
import { RevealGroup } from "@/components/admin/motion/reveal";
import { AnimatedCounter } from "@/components/admin/motion/animated-counter";
import { GenerateContentPanel } from "@/components/admin/content-queue/generate-content-panel";
import { ContentQueueItemCard } from "@/components/admin/content-queue/content-queue-item-card";
import {
  fetchContentQueue,
  fetchContentQueueCounts,
  type ContentQueueItem,
  type ContentQueueStatus,
} from "@/lib/frontend/admin-content-queue-client";
import type { ContentQueueCharacter } from "@/lib/frontend/admin-content-queue";
import { cn } from "@/lib/utils";

const STATUS_TABS: { value: ContentQueueStatus; label: string }[] = [
  { value: "pending_review", label: "Pending review" },
  { value: "queued", label: "Queued" },
  { value: "generating", label: "Generating" },
  { value: "published", label: "Published" },
  { value: "failed", label: "Failed" },
  { value: "rejected", label: "Rejected" },
];

const CONTENT_TYPE_TABS = [
  { value: "all", label: "All types" },
  { value: "image", label: "Image" },
  { value: "chat_line", label: "Chat Lines" },
  { value: "video", label: "Video" },
];

export function ContentQueueConsole({
  initialItems,
  initialCounts,
  characters,
}: {
  initialItems: ContentQueueItem[];
  initialCounts: Record<ContentQueueStatus, number>;
  characters: ContentQueueCharacter[];
}) {
  const [status, setStatus] = useState<ContentQueueStatus>("pending_review");
  const [contentType, setContentType] = useState<string>("all");
  const [items, setItems] = useState(initialItems);
  const [counts, setCounts] = useState(initialCounts);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback((s: ContentQueueStatus, ct: string) => {
    setLoading(true);
    fetchContentQueue({ status: s, contentType: ct as never })
      .then((res) => {
        setItems(res.items);
        setHasMore(res.hasMore);
      })
      .finally(() => setLoading(false));
  }, []);

  // Skip the redundant initial fetch — the server already loaded the
  // default (pending_review / all) view; only refetch when filters
  // actually change away from that.
  const isDefaultView = status === "pending_review" && contentType === "all";
  useEffect(() => {
    if (isDefaultView) {
      setItems(initialItems);
      setHasMore(false);
      return;
    }
    load(status, contentType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, contentType]);

  function refreshCounts() {
    fetchContentQueueCounts().then(setCounts).catch(() => {});
  }

  async function loadMore() {
    setLoadingMore(true);
    try {
      const oldest = items[items.length - 1];
      const res = await fetchContentQueue({
        status,
        contentType: contentType as never,
        before: oldest?.created_at,
      });
      setItems((prev) => [...prev, ...res.items]);
      setHasMore(res.hasMore);
    } finally {
      setLoadingMore(false);
    }
  }

  function handleItemUpdated(updated: ContentQueueItem) {
    setItems((prev) => {
      // Once an item's status no longer matches the tab being viewed
      // (e.g. publish moves it out of "pending_review"), drop it from
      // this list — the stat row above is the source of truth for where
      // it went, and it'll show up under its new tab on next visit.
      if (updated.status !== status) return prev.filter((i) => i.id !== updated.id);
      return prev.map((i) => (i.id === updated.id ? updated : i));
    });
    refreshCounts();
  }

  function handleGenerated(item: ContentQueueItem) {
    if (isDefaultView || item.status === status) {
      setItems((prev) => [item, ...prev.filter((i) => i.id !== item.id)]);
    }
    refreshCounts();
  }

  return (
    <div className="space-y-6">
      <RevealGroup className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setStatus(tab.value)}
            className="text-left"
          >
            <Card
              interactive
              className={cn(
                "p-3.5 transition-colors ease-premium",
                status === tab.value && "border-gold-500/60",
              )}
            >
              <p
                className={cn(
                  "font-display text-2xl tabular-nums",
                  status === tab.value ? "text-gold-400" : "text-text-primary",
                )}
              >
                <AnimatedCounter value={counts[tab.value] ?? 0} />
              </p>
              <p className="text-[11px] text-text-secondary mt-0.5">{tab.label}</p>
            </Card>
          </button>
        ))}
      </RevealGroup>

      <GenerateContentPanel characters={characters} onGenerated={handleGenerated} />

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <FilterPillGroup options={CONTENT_TYPE_TABS} value={contentType} onChange={setContentType} />
      </div>

      {loading ? (
        <p className="text-text-secondary text-sm py-8 text-center">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-text-tertiary text-sm py-12 text-center border border-border-hairline rounded-md">
          Nothing in {STATUS_TABS.find((t) => t.value === status)?.label.toLowerCase()}.
        </p>
      ) : (
        <RevealGroup className="space-y-3">
          {items.map((item) => (
            <ContentQueueItemCard key={item.id} item={item} onUpdated={handleItemUpdated} />
          ))}
        </RevealGroup>
      )}

      {hasMore && (
        <div className="flex justify-center">
          <Button size="sm" variant="ghost" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}

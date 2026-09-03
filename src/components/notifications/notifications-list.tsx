"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { BellOff, CheckCheck, Loader2, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { FilterPillGroup, type FilterPillOption } from "@/components/ui/filter-pills";
import { getNotificationIcon, getNotificationIconClass } from "./notification-icon";
import { useNotificationStore } from "@/lib/notifications/store";
import {
  NOTIFICATION_CATEGORIES,
  CATEGORY_LABELS,
  CATEGORY_TYPES,
  type NotificationCategory,
} from "@/lib/notifications/types";
import type { NotificationItem } from "@/lib/frontend/notifications";

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(date)) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return date.toLocaleDateString(undefined, { weekday: "long" });
  return date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: diffDays > 365 ? "numeric" : undefined,
  });
}

const FILTER_OPTIONS: FilterPillOption[] = [
  { value: "all", label: "All" },
  ...NOTIFICATION_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] })),
];

type CategoryFilter = "all" | NotificationCategory;

/**
 * §11 rebuild: the previous version was a flat, unfiltered, 50-item cap
 * with no way to page past it despite the inbox API already supporting
 * cursor pagination, no per-type visual distinction (every row used the
 * same plain Bell icon), and no way to delete anything. This version adds
 * category filtering + unread-only (server-side, see inbox/route.ts's new
 * `types` param — filtering client-side over one fetched page would break
 * pagination correctness), day-grouped sections, per-type icons, delete
 * (single + bulk "clear read"), infinite scroll, and live merging from the
 * realtime store so items appearing elsewhere in the app (bell, toasts)
 * also appear here without a refresh.
 */
export function NotificationsList({
  initial,
  initialUnreadCount,
  initialNextCursor,
}: {
  initial: NotificationItem[];
  initialUnreadCount: number;
  initialNextCursor: string | null;
}) {
  const [items, setItems] = useState(initial);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [clearingRead, setClearingRead] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingFilter, setLoadingFilter] = useState(false);

  const storeRecent = useNotificationStore((s) => s.recent);
  const storeRemove = useNotificationStore((s) => s.remove);
  const storeMarkRead = useNotificationStore((s) => s.markRead);
  const storeMarkAllRead = useNotificationStore((s) => s.markAllRead);

  const loadingRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const matchesFilters = useCallback(
    (n: NotificationItem) => {
      if (unreadOnly && n.read_at) return false;
      if (category !== "all" && !(CATEGORY_TYPES[category] as readonly string[]).includes(n.type)) return false;
      return true;
    },
    [category, unreadOnly]
  );

  // Live merge: anything the realtime subscription delivers to the global
  // store (new rows, or read-state changes from another tab/device) is
  // reflected here too, so this page doesn't go stale while left open.
  useEffect(() => {
    setItems((prev) => {
      let changed = false;
      const updated = prev.map((n) => {
        const fromStore = storeRecent.find((s) => s.id === n.id);
        if (fromStore && fromStore.read_at !== n.read_at) {
          changed = true;
          return { ...n, read_at: fromStore.read_at };
        }
        return n;
      });
      const existingIds = new Set(updated.map((n) => n.id));
      const freshOnes = storeRecent.filter((s) => !existingIds.has(s.id) && matchesFilters(s));
      if (freshOnes.length > 0) {
        changed = true;
        setUnreadCount((c) => c + freshOnes.filter((n) => !n.read_at).length);
        return [...freshOnes, ...updated];
      }
      return changed ? updated : prev;
    });
  }, [storeRecent, matchesFilters]);

  async function runFilterChange(nextCategory: CategoryFilter, nextUnreadOnly: boolean) {
    setCategory(nextCategory);
    setUnreadOnly(nextUnreadOnly);
    setLoadingFilter(true);
    try {
      const sp = new URLSearchParams({ limit: "20" });
      if (nextUnreadOnly) sp.set("unreadOnly", "true");
      if (nextCategory !== "all") sp.set("types", CATEGORY_TYPES[nextCategory].join(","));
      const res = await fetch(`/api/notifications/inbox?${sp.toString()}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        notifications: NotificationItem[];
        nextCursor: string | null;
        unreadCount: number;
      };
      setItems(data.notifications);
      setNextCursor(data.nextCursor);
      setUnreadCount(data.unreadCount);
    } finally {
      setLoadingFilter(false);
    }
  }

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingRef.current) return;
    loadingRef.current = true;
    setLoadingMore(true);
    try {
      const sp = new URLSearchParams({ limit: "20", cursor: nextCursor });
      if (unreadOnly) sp.set("unreadOnly", "true");
      if (category !== "all") sp.set("types", CATEGORY_TYPES[category].join(","));
      const res = await fetch(`/api/notifications/inbox?${sp.toString()}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { notifications: NotificationItem[]; nextCursor: string | null };
      setItems((prev) => {
        const existingIds = new Set(prev.map((n) => n.id));
        return [...prev, ...data.notifications.filter((n) => !existingIds.has(n.id))];
      });
      setNextCursor(data.nextCursor);
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
    }
  }, [nextCursor, unreadOnly, category]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !nextCursor) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: "200px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [nextCursor, loadMore]);

  async function markRead(id: string) {
    const target = items.find((n) => n.id === id);
    if (!target || target.read_at) return;
    // Optimistic — this is a read-state toggle with no meaningful failure
    // mode for the user to react to, matching notifications/read/route.ts's
    // own scoped, idempotent update (re-marking an already-read row is a
    // silent no-op there too).
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
    storeMarkRead(id); // keeps the bell badge/dropdown in sync while this page is open
    fetch("/api/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {});
  }

  async function markAllRead() {
    setMarkingAll(true);
    setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
    setUnreadCount(0);
    storeMarkAllRead();
    try {
      await fetch("/api/notifications/read-all", { method: "POST" });
    } finally {
      setMarkingAll(false);
    }
  }

  async function deleteOne(id: string) {
    const removed = items.find((n) => n.id === id);
    setItems((prev) => prev.filter((n) => n.id !== id));
    if (removed && !removed.read_at) setUnreadCount((c) => Math.max(0, c - 1));
    storeRemove(id);
    try {
      const res = await fetch(`/api/notifications/${id}`, { method: "DELETE" });
      if (!res.ok && removed) {
        // Unlike mark-read, deletion is destructive — roll back on failure
        // instead of leaving the row silently gone.
        setItems((prev) => [removed, ...prev].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)));
        if (!removed.read_at) setUnreadCount((c) => c + 1);
      }
    } catch {
      if (removed) {
        setItems((prev) => [removed, ...prev].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)));
        if (!removed.read_at) setUnreadCount((c) => c + 1);
      }
    }
  }

  const readCount = items.filter((n) => n.read_at).length;

  async function clearRead() {
    if (readCount === 0) return;
    setClearingRead(true);
    const removedIds = new Set(items.filter((n) => n.read_at).map((n) => n.id));
    setItems((prev) => prev.filter((n) => !removedIds.has(n.id)));
    for (const id of removedIds) storeRemove(id);
    try {
      await fetch("/api/notifications?scope=read", { method: "DELETE" });
    } finally {
      setClearingRead(false);
    }
  }

  const grouped = useMemo(() => {
    const groups: { label: string; items: NotificationItem[] }[] = [];
    for (const n of items) {
      const label = dayLabel(n.created_at);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.items.push(n);
      else groups.push({ label, items: [n] });
    }
    return groups;
  }, [items]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3">
        <h1 className="font-display text-xl text-text-primary">
          Notifications
          {unreadCount > 0 && (
            <span className="ml-2 text-sm text-gold-400 font-sans font-semibold">
              {unreadCount} unread
            </span>
          )}
        </h1>
        <div className="flex items-center gap-3 shrink-0">
          {readCount > 0 && (
            <button
              onClick={clearRead}
              disabled={clearingRead}
              className="flex items-center gap-1 text-xs text-text-tertiary hover:text-text-secondary disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" /> Clear read
            </button>
          )}
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              disabled={markingAll}
              className="flex items-center gap-1 text-sm text-gold-400 hover:text-gold-300 font-semibold disabled:opacity-50"
            >
              <CheckCheck className="h-3.5 w-3.5" /> Mark all read
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 mb-5">
        <FilterPillGroup
          options={FILTER_OPTIONS}
          value={category}
          onChange={(v) => runFilterChange(v as CategoryFilter, unreadOnly)}
        />
        <button
          role="switch"
          aria-checked={unreadOnly}
          onClick={() => runFilterChange(category, !unreadOnly)}
          className={cn(
            "shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ease-premium",
            unreadOnly
              ? "bg-gold-500 border-gold-500 text-[#160F02]"
              : "border-border-hairline text-text-secondary hover:text-text-primary"
          )}
        >
          Unread only
        </button>
      </div>

      {loadingFilter ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-5 w-5 text-text-tertiary animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <BellOff className="h-10 w-10 text-text-tertiary" />
          <p className="text-text-secondary">
            {unreadOnly || category !== "all" ? "Nothing matches this filter." : "You\u2019re all caught up."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {grouped.map((group) => (
            <div key={group.label}>
              <div className="text-xs font-semibold uppercase tracking-wide text-text-tertiary mb-2">
                {group.label}
              </div>
              <div className="flex flex-col gap-1.5">
                {group.items.map((n) => {
                  const unread = !n.read_at;
                  const Icon = getNotificationIcon(n.type);
                  const content = (
                    <div
                      className={cn(
                        "group relative flex items-start gap-3 rounded-md border border-border-hairline px-4 py-3 transition-colors ease-premium",
                        unread ? "bg-gold-500/[0.04]" : "hover:border-white/20"
                      )}
                    >
                      <Icon
                        className={cn("h-4 w-4 shrink-0 mt-0.5", getNotificationIconClass(n.type, unread))}
                        strokeWidth={1.75}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-text-primary font-medium">{n.title}</div>
                        {n.body && (
                          <div className="text-xs text-text-secondary mt-0.5 line-clamp-2">{n.body}</div>
                        )}
                        <div className="text-[11px] text-text-tertiary mt-1">{timeAgo(n.created_at)}</div>
                      </div>
                      {unread && <span className="h-2 w-2 rounded-full bg-gold-500 shrink-0 mt-1.5" />}
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          deleteOne(n.id);
                        }}
                        aria-label="Delete notification"
                        className="shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100 text-text-tertiary hover:text-danger transition-opacity ease-premium mt-0.5"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );

                  return n.cta_url ? (
                    <Link key={n.id} href={n.cta_url} onClick={() => markRead(n.id)}>
                      {content}
                    </Link>
                  ) : (
                    <button key={n.id} onClick={() => markRead(n.id)} className="text-left">
                      {content}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {nextCursor && (
            <div ref={sentinelRef} className="flex justify-center py-4">
              {loadingMore && <Loader2 className="h-4 w-4 text-text-tertiary animate-spin" />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

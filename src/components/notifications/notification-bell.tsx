"use client";

import Link from "next/link";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Bell, BellOff, CheckCheck } from "lucide-react";
import { useNotificationStore } from "@/lib/notifications/store";
import { getNotificationIcon, getNotificationIconClass } from "./notification-icon";
import { cn } from "@/lib/utils";

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

/**
 * Replaces the old plain Link+badge in top-bar.tsx (§11) — that version
 * only ever showed the unread count computed once at layout render, and
 * clicking it always full-navigated to /notifications for even a single
 * glance. This reads live from useNotificationStore (kept current by
 * NotificationCenterProvider's realtime subscription) and surfaces the
 * most recent items inline, so most "did anything happen" checks never
 * need to leave the current page.
 */
export function NotificationBell() {
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const recent = useNotificationStore((s) => s.recent);
  const markRead = useNotificationStore((s) => s.markRead);
  const markAllRead = useNotificationStore((s) => s.markAllRead);

  async function handleMarkRead(id: string, alreadyRead: boolean) {
    if (alreadyRead) return;
    markRead(id);
    fetch("/api/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {});
  }

  async function handleMarkAllRead() {
    markAllRead();
    fetch("/api/notifications/read-all", { method: "POST" }).catch(() => {});
  }

  const preview = recent.slice(0, 8);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          aria-label="Notifications"
          className="relative h-10 w-10 flex items-center justify-center rounded-xs text-text-secondary hover:text-text-primary hover:bg-white/[0.04] transition-colors ease-premium"
        >
          <Bell className="h-5 w-5" strokeWidth={1.75} />
          {unreadCount > 0 && (
            <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-gold-500 text-[#160F02] text-[10px] font-bold flex items-center justify-center">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={10}
          className="w-80 rounded-md border border-border-hairline bg-base shadow-card p-0 z-50 animate-fade-in overflow-hidden"
        >
          <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border-hairline">
            <span className="text-sm font-semibold text-text-primary">Notifications</span>
            {unreadCount > 0 && (
              <DropdownMenu.Item
                onSelect={(e) => {
                  e.preventDefault();
                  handleMarkAllRead();
                }}
                className="flex items-center gap-1 text-xs font-semibold text-gold-400 hover:text-gold-300 outline-none cursor-pointer"
              >
                <CheckCheck className="h-3.5 w-3.5" /> Mark all read
              </DropdownMenu.Item>
            )}
          </div>

          {preview.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center px-4">
              <BellOff className="h-7 w-7 text-text-tertiary" />
              <p className="text-xs text-text-secondary">You&rsquo;re all caught up.</p>
            </div>
          ) : (
            <div className="max-h-[70dvh] overflow-y-auto">
              {preview.map((n) => {
                const unread = !n.read_at;
                const Icon = getNotificationIcon(n.type);
                const row = (
                  <div
                    className={cn(
                      "flex items-start gap-2.5 px-3.5 py-2.5 transition-colors ease-premium",
                      unread ? "bg-gold-500/[0.04]" : "hover:bg-white/[0.03]"
                    )}
                  >
                    <Icon className={cn("h-4 w-4 shrink-0 mt-0.5", getNotificationIconClass(n.type, unread))} strokeWidth={1.75} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-text-primary font-medium truncate">{n.title}</div>
                      {n.body && (
                        <div className="text-xs text-text-secondary mt-0.5 line-clamp-2">{n.body}</div>
                      )}
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1 mt-0.5">
                      <span className="text-[11px] text-text-tertiary">{timeAgo(n.created_at)}</span>
                      {unread && <span className="h-1.5 w-1.5 rounded-full bg-gold-500" />}
                    </div>
                  </div>
                );

                return (
                  <DropdownMenu.Item key={n.id} asChild>
                    {n.cta_url ? (
                      <Link
                        href={n.cta_url}
                        onClick={() => handleMarkRead(n.id, !unread)}
                        className="block outline-none cursor-pointer"
                      >
                        {row}
                      </Link>
                    ) : (
                      <button
                        onClick={() => handleMarkRead(n.id, !unread)}
                        className="block w-full text-left outline-none cursor-pointer"
                      >
                        {row}
                      </button>
                    )}
                  </DropdownMenu.Item>
                );
              })}
            </div>
          )}

          <DropdownMenu.Item asChild>
            <Link
              href="/notifications"
              className="block px-3.5 py-2.5 text-center text-xs font-semibold text-gold-400 hover:text-gold-300 border-t border-border-hairline outline-none cursor-pointer"
            >
              View all
            </Link>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

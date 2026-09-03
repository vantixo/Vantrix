"use client";

import { create } from "zustand";
import type { NotificationItem } from "@/lib/frontend/notifications";

export interface ToastNotification extends NotificationItem {
  /** Distinct from `id` (the DB row id) so the same row can never render
   *  two stacked toasts if a duplicate INSERT event slips through. */
  toastId: string;
}

interface NotificationCenterState {
  hydrated: boolean;
  unreadCount: number;
  /** Most recent notifications (read + unread), newest first, capped —
   *  backs the bell dropdown preview. The full paginated list on
   *  /notifications manages its own separate state. */
  recent: NotificationItem[];
  toasts: ToastNotification[];

  /** Seed from server-rendered props. Only the first call after a hard
   *  load does anything — later ones are no-ops so a client-side
   *  navigation (which re-runs the layout's server component and hands
   *  down fresh-but-now-stale props) can't clobber live state the store
   *  has since learned about via realtime. */
  hydrate: (unreadCount: number, recent: NotificationItem[]) => void;
  /** A new row landed (realtime INSERT, or optimistic local echo). */
  receive: (n: NotificationItem) => void;
  /** A row changed (realtime UPDATE — most commonly read_at set from
   *  another tab/device). */
  syncRead: (n: NotificationItem) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  remove: (id: string) => void;
  dismissToast: (toastId: string) => void;
}

const RECENT_CAP = 20;
// Cap at insertion time, not just at render time — the toast stack only
// ever *renders* the last MAX_VISIBLE_TOASTS entries, so anything beyond
// that would sit in state with no mounted <Toast> to start its own
// auto-dismiss timer and would never clear on its own. Capping here means
// a burst of activity drops the oldest un-shown toasts instead of leaking
// them indefinitely.
const MAX_VISIBLE_TOASTS = 3;

export const useNotificationStore = create<NotificationCenterState>((set) => ({
  hydrated: false,
  unreadCount: 0,
  recent: [],
  toasts: [],

  hydrate: (unreadCount, recent) =>
    set((s) => (s.hydrated ? s : { hydrated: true, unreadCount, recent })),

  receive: (n) =>
    set((s) => {
      if (s.recent.some((x) => x.id === n.id)) return s;
      return {
        unreadCount: n.read_at ? s.unreadCount : s.unreadCount + 1,
        recent: [n, ...s.recent].slice(0, RECENT_CAP),
        toasts: n.read_at
          ? s.toasts
          : [...s.toasts, { ...n, toastId: `${n.id}-${Date.now()}` }].slice(-MAX_VISIBLE_TOASTS),
      };
    }),

  syncRead: (n) =>
    set((s) => {
      const existing = s.recent.find((x) => x.id === n.id);
      // Can only tell whether this is a net-new "read" transition (and so
      // whether unreadCount should move) for rows already in the local
      // `recent` cache; an update to something older isn't reflected in
      // the count here — acceptable, since unreadCount itself was seeded
      // correctly at hydrate and read/read-all responses already update
      // it directly for the common case (the user's own action).
      const wasUnread = existing ? !existing.read_at : false;
      const nowRead = Boolean(n.read_at);
      const delta = wasUnread && nowRead ? -1 : 0;
      return {
        unreadCount: Math.max(0, s.unreadCount + delta),
        recent: s.recent.map((x) => (x.id === n.id ? { ...x, read_at: n.read_at } : x)),
      };
    }),

  markRead: (id) =>
    set((s) => {
      const target = s.recent.find((n) => n.id === id);
      if (!target || target.read_at) return s;
      const readAt = new Date().toISOString();
      return {
        unreadCount: Math.max(0, s.unreadCount - 1),
        recent: s.recent.map((n) => (n.id === id ? { ...n, read_at: readAt } : n)),
      };
    }),

  markAllRead: () =>
    set((s) => ({
      unreadCount: 0,
      recent: s.recent.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })),
    })),

  remove: (id) =>
    set((s) => {
      const target = s.recent.find((n) => n.id === id);
      const wasUnread = Boolean(target && !target.read_at);
      return {
        unreadCount: wasUnread ? Math.max(0, s.unreadCount - 1) : s.unreadCount,
        recent: s.recent.filter((n) => n.id !== id),
      };
    }),

  dismissToast: (toastId) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.toastId !== toastId) })),
}));

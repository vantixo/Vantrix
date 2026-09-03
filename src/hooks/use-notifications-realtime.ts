"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useNotificationStore } from "@/lib/notifications/store";
import type { NotificationItem } from "@/lib/frontend/notifications";

/**
 * Subscribes to Postgres Changes on `notifications` for the current user
 * (see 20260934_notifications_realtime.sql) and pipes INSERT/UPDATE rows
 * into the shared notification store — the bell badge, dropdown preview,
 * and toast stack all read from that store, so this one subscription
 * drives all three instead of each polling or fetching independently.
 *
 * Mounted once, in NotificationCenterProvider (shell layout level) — not
 * per-component — so navigating between pages never opens a second
 * channel for the same user.
 */
export function useNotificationsRealtime(userId: string) {
  const receive = useNotificationStore((s) => s.receive);
  const syncRead = useNotificationStore((s) => s.syncRead);

  // Refs so the effect's cleanup/subscribe closure always calls the
  // latest store actions without needing them in the dependency array
  // (they're stable zustand references anyway, but this keeps the effect
  // keyed only on userId, which is what should actually re-subscribe).
  const receiveRef = useRef(receive);
  receiveRef.current = receive;
  const syncReadRef = useRef(syncRead);
  syncReadRef.current = syncRead;

  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();

    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => receiveRef.current(payload.new as unknown as NotificationItem)
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => syncReadRef.current(payload.new as unknown as NotificationItem)
      )
      .subscribe();

    // Belt-and-suspenders resync: if the tab was backgrounded/asleep or
    // the realtime socket dropped and silently reconnected, catch up on
    // whatever was missed instead of trusting the count stayed accurate
    // indefinitely. Cheap (one small GET) and only runs on the visibility
    // transition, not on a timer.
    const resync = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/notifications/inbox?limit=20", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { notifications: NotificationItem[]; unreadCount: number };
        useNotificationStore.setState({
          hydrated: true,
          unreadCount: data.unreadCount,
          recent: data.notifications,
        });
      } catch {
        // Best-effort — the realtime subscription is still live and will
        // catch anything from this point forward regardless.
      }
    };
    document.addEventListener("visibilitychange", resync);

    return () => {
      document.removeEventListener("visibilitychange", resync);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
}

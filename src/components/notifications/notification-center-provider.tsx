"use client";

import { useEffect } from "react";
import { useNotificationStore } from "@/lib/notifications/store";
import { useNotificationsRealtime } from "@/hooks/use-notifications-realtime";
import { NotificationToastStack } from "./notification-toast-stack";
import type { NotificationItem } from "@/lib/frontend/notifications";

/**
 * Mounted once in (app)/layout.tsx, sibling to TopBar. Does three things:
 *   1. Seeds the store from the server-rendered profile (unread count +
 *      recent items) — see lib/frontend/session.ts.
 *   2. Opens the single realtime subscription for this user (bell,
 *      dropdown, and toast stack all then read from the store rather than
 *      each subscribing independently).
 *   3. Renders the toast stack, since it needs to live above every page,
 *      not just the ones that happen to render a bell.
 * No visual output of its own beyond the (fixed-positioned, portal-free)
 * toast stack — this is a side-effect component, same pattern as
 * AnalyticsIdentify already used in the same layout.
 */
export function NotificationCenterProvider({
  userId,
  initialUnreadCount,
  initialRecent,
}: {
  userId: string;
  initialUnreadCount: number;
  initialRecent: NotificationItem[];
}) {
  const hydrate = useNotificationStore((s) => s.hydrate);

  useEffect(() => {
    hydrate(initialUnreadCount, initialRecent);
    // Intentionally only on mount — hydrate() itself is a no-op after the
    // first call, so this can't stomp live state on a later re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useNotificationsRealtime(userId);

  return <NotificationToastStack />;
}

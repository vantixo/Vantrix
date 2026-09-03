import { getNotificationInbox } from "@/lib/frontend/notifications";
import { NotificationsList } from "@/components/notifications/notifications-list";

export const dynamic = "force-dynamic";

/**
 * §11: top bar's notification bell (with count badge, see top-bar.tsx)
 * targets this route — previously a 404 despite the bell already
 * rendering an unread count from somewhere upstream.
 */
export default async function NotificationsPage() {
  const inbox = await getNotificationInbox({ limit: 20 });

  return (
    <div className="mx-auto max-w-2xl px-4 md:px-8 py-6">
      <NotificationsList
        initial={inbox.notifications}
        initialUnreadCount={inbox.unreadCount}
        initialNextCursor={inbox.nextCursor}
      />
    </div>
  );
}

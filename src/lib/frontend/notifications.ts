import "server-only";
import { fetchInternal } from "./api";

/**
 * Mirrors GET /api/notifications/inbox's response exactly (see that
 * route's column select + keyset-pagination/unreadCount shaping) — real
 * request-shaping logic lives in the handler, so per §10 this goes
 * through fetchInternal rather than a raw table query here.
 */
export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  cta_url: string | null;
  icon: string | null;
  urgency: string | null;
  metadata: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
}

export interface NotificationInboxPage {
  notifications: NotificationItem[];
  nextCursor: string | null;
  unreadCount: number;
}

const EMPTY_INBOX: NotificationInboxPage = {
  notifications: [],
  nextCursor: null,
  unreadCount: 0,
};

export async function getNotificationInbox(params?: {
  cursor?: string;
  limit?: number;
}): Promise<NotificationInboxPage> {
  const sp = new URLSearchParams();
  if (params?.cursor) sp.set("cursor", params.cursor);
  if (params?.limit) sp.set("limit", String(params.limit));
  const qs = sp.toString();

  try {
    return await fetchInternal<NotificationInboxPage>(
      `/api/notifications/inbox${qs ? `?${qs}` : ""}`
    );
  } catch {
    return EMPTY_INBOX;
  }
}

/**
 * GET /api/notifications/inbox — paginated notification history
 *
 * Query params:
 *   cursor     — ISO timestamp; returns notifications created before this (keyset pagination)
 *   limit      — page size, default 20, max 50
 *   unreadOnly — "true" to filter to unread only
 *   types      — comma-separated NotificationType list (e.g. from a
 *                category filter on the notifications page) — filtering
 *                happens here, not client-side, so pagination stays
 *                correct: a client-side filter over one page could show
 *                far fewer than `limit` matching rows with no way to tell
 *                whether more exist without fetching again.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/get-authed-user";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { isNotificationType } from "@/lib/notifications/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get("cursor");
  const unreadOnly = searchParams.get("unreadOnly") === "true";
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "20", 10) || 20, 1), 50);
  const typesParam = searchParams.get("types");
  const types = typesParam
    ? typesParam.split(",").map((t) => t.trim()).filter(isNotificationType)
    : null;

  let query = supabaseAdmin
    .from("notifications")
    .select("id,type,title,body,cta_url,icon,urgency,metadata,read_at,created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (cursor) query = query.lt("created_at", cursor);
  if (unreadOnly) query = query.is("read_at", null);
  if (types && types.length > 0) query = query.in("type", types);

  const [{ data, error }, { count: unreadCount }] = await Promise.all([
    query,
    supabaseAdmin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("read_at", null),
  ]);

  if (error) {
    logger.error("notifications:inbox-list-error", { userId: user.id, error: error.message });
    return NextResponse.json({ error: "Failed to load notifications" }, { status: 500 });
  }

  const items = data ?? [];
  const nextCursor = items.length === limit ? items[items.length - 1].created_at : null;

  return NextResponse.json({
    notifications: items,
    nextCursor,
    unreadCount: unreadCount ?? 0,
  });
}

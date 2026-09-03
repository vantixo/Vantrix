/**
 * DELETE /api/notifications/[id] — remove a single notification from the
 * caller's own inbox.
 *
 * New endpoint — the inbox previously only supported mark-read/mark-all-
 * read (see ../read, ../read-all); there was no way to actually clear an
 * item out. Scoped to `user_id = caller` the same way read/route.ts
 * scopes its UPDATE — supabaseAdmin is a service-role client with no
 * implicit RLS check, so the ownership predicate has to be applied here
 * explicitly rather than relied on from the database.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/get-authed-user";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.string().uuid() });

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = paramsSchema.safeParse(params);
  if (!parsed.success) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const { error, count } = await supabaseAdmin
    .from("notifications")
    .delete({ count: "exact" })
    .eq("id", parsed.data.id)
    .eq("user_id", user.id);

  if (error) {
    logger.error("notifications:delete-error", { userId: user.id, id: parsed.data.id, error: error.message });
    return NextResponse.json({ error: "Failed to delete notification" }, { status: 500 });
  }

  if (!count) {
    // Either it never existed or belonged to someone else — both look the
    // same from the outside, which is the correct behavior here.
    return NextResponse.json({ error: "Notification not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

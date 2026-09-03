/**
 * POST /api/notifications/read — mark one notification as read
 * Body: { id: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/get-authed-user";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const schema = z.object({ id: z.string().uuid() });

export async function POST(req: NextRequest) {
  const { user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const { error } = await supabaseAdmin
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", parsed.data.id)
    .eq("user_id", user.id) // scope to owner — a service-role client has no implicit RLS check
    .is("read_at", null);

  if (error) {
    logger.error("notifications:mark-read-error", { userId: user.id, error: error.message });
    return NextResponse.json({ error: "Failed to mark read" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

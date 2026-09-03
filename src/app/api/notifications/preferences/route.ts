/**
 * GET/PUT /api/notifications/preferences
 *
 * GET  -> effective per-type { inApp, push } prefs (defaults merged with
 *         any stored overrides).
 * PUT  -> body: { type: NotificationType, inApp?: boolean, push?: boolean }
 *         Upserts a single type's override. security_alert is not
 *         user-mutable (account safety) and is rejected.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/get-authed-user";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import type { Json } from "@/types/supabase";
import {
  NOTIFICATION_DEFAULTS,
  NOTIFICATION_LABELS,
  NON_MUTABLE_TYPES,
  NOTIFICATION_TYPES,
  isNotificationType,
  type NotificationPrefsMap,
} from "@/lib/notifications/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const { user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from("notification_preferences")
    .select("prefs")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    logger.error("notifications:preferences-get-error", { userId: user.id, error: error.message });
    return NextResponse.json({ error: "Failed to load preferences" }, { status: 500 });
  }

  const overrides = (data?.prefs ?? {}) as Partial<Record<string, Partial<{ inApp: boolean; push: boolean }>>>;
  const effective = { ...NOTIFICATION_DEFAULTS } as NotificationPrefsMap;
  for (const type of NOTIFICATION_TYPES) {
    if (overrides[type]) effective[type] = { ...effective[type], ...overrides[type] };
  }

  const preferences = NOTIFICATION_TYPES.map((type) => ({
    type,
    ...NOTIFICATION_LABELS[type],
    inApp: effective[type].inApp,
    push: effective[type].push,
    mutable: !NON_MUTABLE_TYPES.includes(type),
  }));

  return NextResponse.json({ preferences });
}

const schema = z.object({
  type: z.string(),
  inApp: z.boolean().optional(),
  push: z.boolean().optional(),
});

export async function PUT(req: NextRequest) {
  const { user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const { type, inApp, push } = parsed.data;
  if (!isNotificationType(type)) {
    return NextResponse.json({ error: "Unknown notification type" }, { status: 400 });
  }
  if (NON_MUTABLE_TYPES.includes(type)) {
    return NextResponse.json({ error: "This notification type cannot be disabled" }, { status: 403 });
  }

  const { data: existing } = await supabaseAdmin
    .from("notification_preferences")
    .select("prefs")
    .eq("user_id", user.id)
    .maybeSingle();

  const prefs = { ...(existing?.prefs as Record<string, unknown> ?? {}) };
  const current = (prefs[type] as { inApp?: boolean; push?: boolean } | undefined) ?? {};
  prefs[type] = {
    inApp: inApp ?? current.inApp ?? true,
    push: push ?? current.push ?? true,
  };

  const { error } = await supabaseAdmin
    .from("notification_preferences")
    .upsert({ user_id: user.id, prefs: prefs as Json, updated_at: new Date().toISOString() }, { onConflict: "user_id" });

  if (error) {
    logger.error("notifications:preferences-put-error", { userId: user.id, error: error.message });
    return NextResponse.json({ error: "Failed to update preferences" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

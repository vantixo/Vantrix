/**
 * emitNotification — single entry point for writing to the notification
 * inbox and fanning out to push.
 *
 * Every trigger site (dating match, gift received, community reply, cron
 * jobs, payment webhooks, the SSE route, ...) calls this instead of
 * touching the `notifications` table or send-push.ts directly, so
 * preference-checking and push fan-out only need to be correct in one
 * place.
 *
 * Always uses supabaseAdmin — trigger sites run with a mix of user-scoped
 * and service-role contexts (crons, webhooks have no user session at all),
 * and a notification write is inherently "on behalf of" a different user
 * than whoever's request/job caused it.
 */
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendPushToUser } from "@/lib/push/send-push";
import { logger, bg } from "@/lib/logger";
import type { Json } from "@/types/supabase";
import {
  NOTIFICATION_DEFAULTS,
  type NotificationType,
  type NotificationUrgency,
  type NotificationPrefsMap,
} from "@/lib/notifications/types";

export interface EmitNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  ctaUrl?: string;
  icon?: string;
  urgency?: NotificationUrgency;
  metadata?: Record<string, unknown>;
  /** Skip the push leg (e.g. caller already pushed via another path). Defaults to false. */
  skipPush?: boolean;
}

async function getEffectivePrefs(userId: string): Promise<NotificationPrefsMap> {
  const { data } = await supabaseAdmin
    .from("notification_preferences")
    .select("prefs")
    .eq("user_id", userId)
    .maybeSingle();

  const overrides = (data?.prefs ?? {}) as Partial<Record<NotificationType, Partial<{ inApp: boolean; push: boolean }>>>;

  const merged = { ...NOTIFICATION_DEFAULTS } as NotificationPrefsMap;
  for (const key of Object.keys(overrides) as NotificationType[]) {
    if (!merged[key]) continue;
    merged[key] = { ...merged[key], ...overrides[key] };
  }
  return merged;
}

export async function emitNotification(input: EmitNotificationInput): Promise<string | null> {
  const {
    userId, type, title, body, ctaUrl, icon,
    urgency = "low", metadata = {}, skipPush = false,
  } = input;

  const prefs = await getEffectivePrefs(userId);
  const typePrefs = prefs[type] ?? { inApp: true, push: true };

  if (!typePrefs.inApp && !typePrefs.push) {
    // Fully muted — don't even write a row the user will never see, so the
    // inbox count/query doesn't have to filter dead rows on every read.
    return null;
  }

  let notificationId: string | null = null;

  if (typePrefs.inApp) {
    const { data, error } = await supabaseAdmin
      .from("notifications")
      .insert({
        user_id: userId,
        type,
        title,
        body,
        cta_url: ctaUrl ?? null,
        icon: icon ?? null,
        urgency,
        metadata: metadata as Json,
      })
      .select("id")
      .single();

    if (error) {
      logger.error("notifications:emit-insert-error", { userId, type, error: error.message });
    } else {
      notificationId = data.id;
    }
  }

  if (typePrefs.push && !skipPush) {
    sendPushToUser(userId, {
      title,
      body,
      url: ctaUrl,
      tag: type,
      data: { type, notificationId, ...metadata },
    })
      .then(async (result) => {
        if (notificationId && result.sent > 0) {
          await supabaseAdmin
            .from("notifications")
            .update({ delivered_push: true })
            .eq("id", notificationId);
        }
      })
      .catch(bg("emitNotification:push"));
  }

  return notificationId;
}

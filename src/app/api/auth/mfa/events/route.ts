/**
 * POST /api/auth/mfa/events
 *
 * Fired by components/profile/two-factor-settings.tsx right after a
 * client-side enroll or unenroll completes against Supabase's own
 * auth.mfa API (see that component's header comment — this route never
 * touches MFA state itself, Supabase already owns that; it only records
 * the resulting account-security notification). Kept as a thin,
 * best-effort side channel: the component doesn't block its own success
 * state on this call, and a failure here never implies the MFA change
 * itself failed.
 *
 * Routed through emitNotification() under the existing `security_alert`
 * type (see lib/notifications/types.ts) so it shows up wherever other
 * account-security events already do, and respects the same
 * NON_MUTABLE_TYPES rule (users can't silence security alerts).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/get-authed-user";
import { emitNotification } from "@/lib/notifications/emit";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const schema = z.object({
  event: z.enum(["enrolled", "disabled"]),
  factorName: z.string().max(80).optional(),
});

export async function POST(req: NextRequest) {
  const { user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const { event, factorName } = parsed.data;
  const device = factorName?.trim() || "an authenticator app";

  const copy =
    event === "enrolled"
      ? { title: "Two-factor authentication enabled", body: `${device} was added to your account.` }
      : { title: "Two-factor authentication device removed", body: `${device} was removed from your account.` };

  try {
    await emitNotification({
      userId: user.id,
      type: "security_alert",
      title: copy.title,
      body: copy.body,
      urgency: "medium",
      metadata: { event: `mfa_${event}` },
    });
  } catch (err) {
    // Best-effort, per header comment — log and still return ok so the
    // client doesn't surface a spurious error for a successful MFA change.
    logger.error("mfa-events:emit-failed", {
      userId: user.id,
      event,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return NextResponse.json({ ok: true });
}

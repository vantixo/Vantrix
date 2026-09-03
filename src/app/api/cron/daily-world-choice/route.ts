/**
 * GET /api/cron/daily-world-choice
 *
 * Runs once daily (vercel.json cron), shortly after the governance/economy
 * ticks so it has fresh city_governance and location_economy state to draw
 * from. Idempotent — if today's choice already exists (e.g. from a retried
 * invocation), this is a no-op.
 *
 * Security: same Bearer-secret pattern as every other cron route
 * (see requireCronAuth in daily-reset).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/security";
import { env } from "@/env";
import { logger } from "@/lib/logger";
import { ensureTodaysChoice } from "@/lib/universe/daily-choice";
import { heartbeatStart, heartbeatSuccess, heartbeatFail } from "@/lib/cron/heartbeat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await heartbeatStart("DAILY_WORLD_CHOICE");

  try {
    const choice = await ensureTodaysChoice();

    if (!choice) {
      logger.warn("daily-world-choice: no choice generated (no world_locations?)");
      await heartbeatFail("DAILY_WORLD_CHOICE");
      return NextResponse.json({ generated: false }, { status: 200 });
    }

    await heartbeatSuccess("DAILY_WORLD_CHOICE");
    return NextResponse.json({ generated: true, choiceId: choice.id, locationName: choice.locationName });

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("daily-world-choice cron failed", { error: message });
    await heartbeatFail("DAILY_WORLD_CHOICE");
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

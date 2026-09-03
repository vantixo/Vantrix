/**
 * POST /api/admin/backfill-universe-images — admin-triggered sweep that
 * generates images for every location/faction/character currently missing
 * one. Safe to call repeatedly: each call only picks up rows still NULL,
 * so a partial failure just means the next call picks up where it left off.
 */

import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/get-authed-user";
import { requireAdmin } from "@/lib/auth/admin";
import { backfillUniverseImages } from "@/lib/content-engine/backfill-universe-images";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST() {
  const { user } = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized — no session" }, { status: 401 });
  }
  try {
    await requireAdmin(user.id);
  } catch {
    return NextResponse.json({ error: "Forbidden — admin role required" }, { status: 403 });
  }

  try {
    const summary = await backfillUniverseImages();
    return NextResponse.json(summary);
  } catch (err) {
    logger.error("api/admin/backfill-universe-images: unhandled error", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

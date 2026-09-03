/**
 * GET /api/cron/universe-images — Universe Visual Coverage Sweep
 *
 * Runs nightly. Generates images for a batch of locations, factions, and
 * characters that currently have none, via backfillUniverseImages(). Safe
 * to run indefinitely — once everything has an image, each run just finds
 * nothing left to do and returns immediately.
 *
 * Security: Vercel Cron injects Authorization: Bearer {CRON_SECRET}.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/security";
import { env } from "@/env";
import { logger } from "@/lib/logger";
import { backfillUniverseImages } from "@/lib/content-engine/backfill-universe-images";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 280;

// Small batch per run — hits paid Fal.ai generation, same rate-limiting
// rationale as /api/cron/content-engine.
const LIMIT_PER_KIND = 15;

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await backfillUniverseImages(LIMIT_PER_KIND);
    logger.info("cron/universe-images: run complete", { ...summary });
    return NextResponse.json(summary);
  } catch (err) {
    logger.error("cron/universe-images: run failed", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

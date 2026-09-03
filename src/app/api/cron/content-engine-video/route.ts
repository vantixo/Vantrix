/**
 * GET /api/cron/content-engine-video — Automatic Content Generation (video)
 *
 * generateCharacterVideo() and the full HotAPI/Atlas video pipeline (see
 * lib/content-engine/generate-video.ts, lib/video/video-router.ts) were
 * fully built but never called from anywhere — the nightly
 * /api/cron/content-engine route only ever generated images and chat-line
 * variety. This is that missing wiring, as its own route rather than
 * folded into that existing job:
 *
 * Video generation polls for up to 5 minutes per item (see
 * generateCharacterVideo's own doc comment), but every cron route in this
 * codebase caps maxDuration at 280 — content-engine, universe-images, and
 * backstory-engine all use exactly that ceiling, never higher, which reads
 * as a real Vercel plan constraint, not an arbitrary choice. Even ONE
 * video generation at the 5-minute default would blow that budget, so:
 *   - This route bounds each poll to VIDEO_POLL_MAX_WAIT_MS (well under
 *     the 280s ceiling, leaving headroom for submit + R2 upload + DB
 *     writes) via generateCharacterVideo's new optional maxWaitMs param.
 *   - It processes at most VIDEO_CHARACTERS_PER_RUN characters (1 by
 *     default) — conservative on purpose, since this hits a paid
 *     per-second video API. Raise it only alongside raising/confirming
 *     the account's actual maxDuration ceiling.
 * Nightly at a small offset from the existing content-engine job (see
 * vercel.json) rather than sharing its invocation, so a slow/failed video
 * run can never take down the (already-working) image/chat-line job.
 *
 * Same safety model as content-engine: everything lands in
 * character_content_queue as "pending_review" via the existing
 * enqueueAndGenerate()/processQueueItem() — nothing is auto-published.
 *
 * CRON_TIER guard (below): even at 200s, this route needs more than Vercel
 * Hobby's 60s hard ceiling. config/cron-jobs.mjs's fitsFreeTier() already
 * keeps this job out of both native Vercel cron and the free-tier GitHub
 * Actions fallback on CRON_TIER=free, so it doesn't get triggered on a
 * schedule in the first place — but a schedule isn't the only way in:
 * requireCronAuth() only checks the secret, not the caller, so a manual
 * curl, a stale external pinger, or CRON_TIER drifting out of sync with
 * the account's actual Vercel plan could still reach this route directly.
 * Any of those would submit a real (paid, per-second) video job and then
 * get killed by the platform mid-poll — spend for a guaranteed failure —
 * so this route independently self-skips on CRON_TIER=free rather than
 * relying solely on never being scheduled.
 *
 * Security: Vercel Cron injects Authorization: Bearer {CRON_SECRET}.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { env } from "@/env";
import { heartbeatStart, heartbeatSuccess, heartbeatFail } from "@/lib/cron/heartbeat";
import { enqueueAndGenerate } from "@/lib/content-engine/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 280;

const VIDEO_CHARACTERS_PER_RUN = 1;
const VIDEO_POLL_MAX_WAIT_MS = 200_000; // 200s poll + ~80s headroom under the 280s ceiling

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const heartbeatName = "CONTENT_ENGINE_VIDEO" as const;
  await heartbeatStart(heartbeatName);

  // See CRON_TIER guard doc comment above — real budget (~280s) doesn't fit
  // Hobby's 60s ceiling no matter who/what triggered this invocation.
  // Skipping is the correct, expected steady-state on free tier (not a
  // failure), so this pings heartbeatSuccess rather than heartbeatFail —
  // the dead man's switch should stay quiet, not page nightly for a job
  // that isn't supposed to run yet.
  if (env.CRON_TIER === "free") {
    logger.warn(
      "cron:content-engine-video skipped — CRON_TIER=free cannot fit this job's ~280s budget inside Vercel Hobby's 60s ceiling; set CRON_TIER=pro once on Vercel Pro to enable",
    );
    await heartbeatSuccess(heartbeatName);
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason:
        "CRON_TIER=free — video generation needs up to ~280s and Vercel Hobby hard-caps invocations at 60s. Upgrade to Vercel Pro and set CRON_TIER=pro to enable this job.",
    });
  }

  try {
    // Video-specific recency, not the general content_content_queue recency
    // the main content-engine cron uses — a character who got an image or
    // chat-line last night shouldn't be skipped for video just because
    // *something* was generated for them recently.
    const { data: recentVideoActivity } = await supabaseAdmin
      .from("character_content_queue")
      .select("character_id, created_at")
      .eq("content_type", "video")
      .order("created_at", { ascending: false });

    const lastVideoAt = new Map<string, string>();
    for (const row of recentVideoActivity ?? []) {
      if (!lastVideoAt.has(row.character_id)) lastVideoAt.set(row.character_id, row.created_at);
    }

    // Only characters with a canon reference sheet can generate video at
    // all (image-to-video needs a source still) — same gate
    // generateCharacterVideo() itself enforces, filtered here too so the
    // rotation isn't wasted on characters guaranteed to fail.
    const { data: characters } = await supabaseAdmin
      .from("characters")
      .select("id,name,canon_sheet_url")
      .eq("active", true)
      .eq("moderation_status", "approved")
      .not("canon_sheet_url", "is", null)
      .limit(500);

    const ranked = (characters ?? [])
      .map((c) => ({ ...c, lastAt: lastVideoAt.get(c.id) ?? "1970-01-01" }))
      .sort((a, b) => (a.lastAt < b.lastAt ? -1 : 1))
      .slice(0, VIDEO_CHARACTERS_PER_RUN);

    let videosGenerated = 0;
    let failures = 0;

    for (const character of ranked) {
      const result = await enqueueAndGenerate({
        characterId: character.id,
        contentType: "video",
        triggeredBy: "cron",
        maxWaitMs: VIDEO_POLL_MAX_WAIT_MS,
      });
      if (result.success) videosGenerated++;
      else failures++;
    }

    logger.info("cron:content-engine-video complete", {
      charactersProcessed: ranked.length,
      videosGenerated,
      failures,
    });

    await heartbeatSuccess(heartbeatName);

    return NextResponse.json({
      ok: true,
      charactersProcessed: ranked.length,
      videosGenerated,
      failures,
    });
  } catch (err) {
    logger.error("cron:content-engine-video failed", { error: String(err) });
    await heartbeatFail(heartbeatName);
    return NextResponse.json({ error: "content-engine-video cron failed" }, { status: 500 });
  }
}

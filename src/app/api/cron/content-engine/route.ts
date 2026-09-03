/**
 * GET /api/cron/content-engine — Automatic Content Generation
 *
 * Runs nightly (add to vercel.json cron alongside the others). For a small
 * rotating batch of active characters, generates one new image and one
 * batch of chat-line variety each — staying on-model via each character's
 * existing canon + trained LoRA (see lib/content-engine).
 *
 * Everything generated lands in character_content_queue as
 * "pending_review" — nothing is published/shown to users automatically.
 * An admin reviews and publishes from /admin/content-engine. This is a
 * deliberate safety choice: automatic *generation* is fine to run
 * unattended, automatic *publishing* of AI-generated character content is
 * not, until a human has looked at it.
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

// Small batch per run — this hits paid generation APIs (Fal for images,
// OpenRouter for text), so it deliberately doesn't try to cover every
// active character every night. Rotates via least-recently-generated-for
// ordering instead.
const CHARACTERS_PER_RUN = 10;

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const heartbeatName = "CONTENT_ENGINE" as const;
  await heartbeatStart(heartbeatName);

  try {
    // Characters that either have no queue history yet, or whose most
    // recent queue item is oldest — keeps rotation fair across the roster
    // instead of always hitting the same characters.
    const { data: recentActivity } = await supabaseAdmin
      .from("character_content_queue")
      .select("character_id, created_at")
      .order("created_at", { ascending: false });

    const lastGeneratedAt = new Map<string, string>();
    for (const row of recentActivity ?? []) {
      if (!lastGeneratedAt.has(row.character_id)) lastGeneratedAt.set(row.character_id, row.created_at);
    }

    const { data: characters } = await supabaseAdmin
      .from("characters")
      .select("id,name,lora_model_id")
      .eq("active", true)
      .eq("moderation_status", "approved")
      .limit(500);

    const ranked = (characters ?? [])
      .map((c) => ({ ...c, lastAt: lastGeneratedAt.get(c.id) ?? "1970-01-01" }))
      .sort((a, b) => (a.lastAt < b.lastAt ? -1 : 1))
      .slice(0, CHARACTERS_PER_RUN);

    let imagesGenerated = 0;
    let chatLinesGenerated = 0;
    let failures = 0;

    for (const character of ranked) {
      // Chat-line variety works for every character regardless of LoRA status.
      const chatResult = await enqueueAndGenerate({
        characterId: character.id,
        contentType: "chat_line",
        triggeredBy: "cron",
        promptInput: "opening_line",
      });
      if (chatResult.success) chatLinesGenerated++;
      else failures++;

      // Image generation requires a trained LoRA — skip characters without one
      // rather than failing loudly every night for the same known reason.
      if (character.lora_model_id) {
        const imageResult = await enqueueAndGenerate({
          characterId: character.id,
          contentType: "image",
          triggeredBy: "cron",
        });
        if (imageResult.success) imagesGenerated++;
        else failures++;
      }
    }

    logger.info("cron:content-engine complete", {
      charactersProcessed: ranked.length,
      imagesGenerated,
      chatLinesGenerated,
      failures,
    });

    await heartbeatSuccess(heartbeatName);

    return NextResponse.json({
      ok: true,
      charactersProcessed: ranked.length,
      imagesGenerated,
      chatLinesGenerated,
      failures,
    });
  } catch (err) {
    logger.error("cron:content-engine failed", { error: String(err) });
    await heartbeatFail(heartbeatName);
    return NextResponse.json({ error: "content-engine cron failed" }, { status: 500 });
  }
}

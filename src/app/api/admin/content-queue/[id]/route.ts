/**
 * PATCH /api/admin/content-queue/[id] — staff decision on one
 * character_content_queue row: publish it into character_content (the
 * user-facing gallery table), reject it, or retry a failed generation.
 *
 * Publishing is a deliberate, reviewable step by design — see the
 * character_content_queue migration's own comment: nothing in this table
 * is ever shown to a user until an admin moves it here. That's the whole
 * reason this route exists rather than generation writing straight to
 * character_content.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/get-authed-user";
import { requireAdmin } from "@/lib/auth/admin";
import { requirePermission } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { toErrorBody, errorLogFields, AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { recordAdminAction } from "@/lib/admin/audit";
import { processQueueItem } from "@/lib/content-engine/queue";
import type { Database } from "@/types/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 280;

const MIN_TIERS = ["free", "spark", "basic", "premium", "elite", "enterprise"] as const;

const patchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("publish"),
    isPremium: z.boolean().optional(),
    minTier: z.enum(MIN_TIERS).optional(),
    displayOrder: z.number().int().min(0).max(9999).optional(),
    // Lets an admin trim/edit generated chat lines before they go live —
    // never applies to image/video (no sensible edit for those).
    resultText: z.string().min(1).max(4000).optional(),
  }),
  z.object({
    action: z.literal("reject"),
    notes: z.string().max(1000).optional(),
  }),
  z.object({
    action: z.literal("retry"),
  }),
]);

const QUEUE_SELECT =
  "id,character_id,content_type,status,prompt_input,result_text,result_url,triggered_by,moderation_category,error,cost_usd,created_at,completed_at,reviewed_by,reviewed_at,characters:character_id(name,image_url)";

interface ContentQueueRow {
  id: string;
  character_id: string;
  content_type: string;
  status: string;
  prompt_input: unknown;
  result_text: string | null;
  result_url: string | null;
  triggered_by: string | null;
  moderation_category: string | null;
  error: string | null;
  cost_usd: number | null;
  created_at: string;
  completed_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  characters: { name: string; image_url: string | null } | { name: string; image_url: string | null }[] | null;
}

function mapRow(row: ContentQueueRow) {
  const character = Array.isArray(row.characters) ? row.characters[0] : row.characters;
  return {
    id: row.id as string,
    character_id: row.character_id as string,
    character_name: (character?.name ?? "Unknown character") as string,
    character_image_url: (character?.image_url ?? null) as string | null,
    content_type: row.content_type as "image" | "chat_line" | "video",
    status: row.status as "queued" | "generating" | "pending_review" | "published" | "rejected" | "failed",
    prompt_input: row.prompt_input as string | null,
    result_text: row.result_text as string | null,
    result_url: row.result_url as string | null,
    triggered_by: row.triggered_by as "admin" | "cron",
    moderation_category: row.moderation_category as string | null,
    error: row.error as string | null,
    cost_usd: row.cost_usd as number | null,
    created_at: row.created_at as string,
    completed_at: row.completed_at as string | null,
    reviewed_by: row.reviewed_by as string | null,
    reviewed_at: row.reviewed_at as string | null,
  };
}

/**
 * Returns the *mapped* (well-typed, character-name-resolved) shape rather
 * than the raw Supabase row. The raw select's return type is only usefully
 * narrow through the query builder's own inference — assigning it to a
 * variable and passing it around (as this route does, checking `.status`,
 * building the character_content insert, etc.) loses that and resolves to
 * an unhelpful generic error type. Routing everything through mapRow()
 * once, here, avoids re-deriving/casting fields at every call site below.
 */
async function loadItem(id: string) {
  const { data } = await supabaseAdmin
    .from("character_content_queue")
    .select(QUEUE_SELECT)
    .eq("id", id)
    .maybeSingle();
  // TYPE-BOUNDARY FIX: QUEUE_SELECT's `characters:character_id(...)` embed
  // can't be resolved against the generated Database relationship types,
  // so supabase-js falls back to unioning in its generic GenericStringError
  // row shape here rather than the real one. mapRow() below already
  // re-asserts every individual field for exactly this reason (see its
  // own doc comment) — this cast just moves that "trust the hand-written
  // ContentQueueRow interface, the runtime shape is known good" boundary
  // to where the raw row first arrives — through `unknown` first since TS
  // correctly refuses a direct assertion between two types this different
  // (that gap is exactly what confirms the mismatch is in Supabase's
  // inference, not the actual runtime shape).
  return data ? mapRow(data as unknown as ContentQueueRow) : null;
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
    await requireAdmin(user.id);
    await requirePermission(user.id, "content.publish");

    const idCheck = z.string().uuid().safeParse(params.id);
    if (!idCheck.success) {
      return NextResponse.json({ error: "Invalid queue item id", code: "VALIDATION_ERROR" }, { status: 400 });
    }

    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", code: "VALIDATION_ERROR", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const body = parsed.data;

    const existing = await loadItem(params.id);
    if (!existing) {
      return NextResponse.json({ error: "Queue item not found", code: "NOT_FOUND" }, { status: 404 });
    }

    if (body.action === "publish") {
      if (existing.status !== "pending_review") {
        return NextResponse.json(
          { error: `Cannot publish an item in status "${existing.status}" — only pending_review items can be published.`, code: "INVALID_STATE" },
          { status: 409 },
        );
      }

      const resultText = body.resultText ?? existing.result_text;
      const insert: Database["public"]["Tables"]["character_content"]["Insert"] = {
        character_id: existing.character_id,
        queue_item_id: existing.id,
        content_type: existing.content_type,
        content_text: existing.content_type === "chat_line" ? resultText : null,
        content_url: existing.content_type === "chat_line" ? null : existing.result_url,
        is_premium: body.isPremium ?? true,
        min_tier: body.minTier ?? "premium",
        display_order: body.displayOrder ?? 0,
        active: true,
      };

      const { error: insertError } = await supabaseAdmin.from("character_content").insert(insert);
      if (insertError) throw insertError;

      const { error: updateError } = await supabaseAdmin
        .from("character_content_queue")
        .update({ status: "published", reviewed_by: user.id, reviewed_at: new Date().toISOString() })
        .eq("id", params.id);
      if (updateError) throw updateError;

      await recordAdminAction({
        adminId: user.id,
        action: "content.published",
        targetType: "content_queue_item",
        targetId: existing.id,
        targetLabel: `${existing.character_name} — ${existing.content_type}`,
        metadata: { minTier: insert.min_tier, isPremium: insert.is_premium },
      });
    } else if (body.action === "reject") {
      if (existing.status !== "pending_review") {
        return NextResponse.json(
          { error: `Cannot reject an item in status "${existing.status}" — only pending_review items can be rejected.`, code: "INVALID_STATE" },
          { status: 409 },
        );
      }

      const { error: updateError } = await supabaseAdmin
        .from("character_content_queue")
        // Reuses `error` to hold the admin's rejection note — the table
        // has no dedicated reason column, and `error` is otherwise only
        // ever populated by generation failures, which "rejected" items
        // by definition are not, so there's no ambiguity in practice.
        .update({
          status: "rejected",
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
          error: body.notes ?? null,
        })
        .eq("id", params.id);
      if (updateError) throw updateError;

      await recordAdminAction({
        adminId: user.id,
        action: "content.rejected",
        targetType: "content_queue_item",
        targetId: existing.id,
        targetLabel: `${existing.character_name} — ${existing.content_type}`,
        metadata: { notes: body.notes ?? null },
      });
    } else {
      // retry — also allowed from "queued"/"generating", not just
      // "failed": those statuses are only ever supposed to be transient
      // (enqueueAndGenerate processes inline right after inserting), so a
      // row stuck there means a prior invocation crashed or hit its
      // platform timeout mid-generation with no automatic recovery. This
      // is the only way to un-stick it short of a direct DB edit.
      if (!["failed", "queued", "generating"].includes(existing.status)) {
        return NextResponse.json(
          { error: `Cannot retry an item in status "${existing.status}".`, code: "INVALID_STATE" },
          { status: 409 },
        );
      }

      // Mirror enqueueAndGenerate's own state transition (queued row ->
      // "generating" before processing starts) — processQueueItem() itself
      // doesn't touch status at the start, only at completion/failure, so
      // without this the row would sit labeled "failed" while a retry is
      // actively in flight.
      await supabaseAdmin
        .from("character_content_queue")
        .update({ status: "generating", error: null })
        .eq("id", params.id);

      const videoMaxWaitMs = existing.content_type === "video" ? 200_000 : undefined;
      const result = await processQueueItem(params.id, videoMaxWaitMs);
      if (!result.success) {
        return NextResponse.json({ error: result.error ?? "Retry failed", code: "GENERATION_FAILED" }, { status: 502 });
      }
    }

    const updated = await loadItem(params.id);
    if (!updated) {
      return NextResponse.json({ error: "Queue item not found after update", code: "NOT_FOUND" }, { status: 404 });
    }

    logger.info("Admin: content-queue item reviewed", { id: params.id, action: body.action, by: user.id });

    return NextResponse.json({ item: updated });
  } catch (err) {
    logger.error("Admin content-queue PATCH error", errorLogFields(err));
    const status = err instanceof AppError ? err.statusCode : 500;
    return NextResponse.json(toErrorBody(err), { status });
  }
}

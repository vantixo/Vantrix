/**
 * GET  /api/admin/content-queue — list character_content_queue rows for
 *      the /admin/content-engine review queue, with status/content_type/
 *      character filters. Also serves per-status counts (?counts=1) for
 *      the stat-card row, since supabase-js has no GROUP BY escape hatch
 *      short of a raw RPC — see loadStatusCounts in admin-content-queue.ts,
 *      which this mirrors for the client-fetched (non-SSR) case.
 * POST /api/admin/content-queue — trigger a new content-engine run for one
 *      character (mirrors what the nightly cron does, on demand). Runs
 *      generation inline via enqueueAndGenerate before responding — see
 *      that function's own doc comment for why there's no background
 *      worker yet. Bounded to maxDuration=280s / a capped video poll, same
 *      ceiling every content-engine cron route in this codebase uses.
 *
 * Read access (GET) only requires admin — same as crisis-events. Both
 * mutating verbs require content.publish, since triggering a paid
 * generation run and deciding what gets published are the same
 * "who's allowed to move content-engine spend/output" capability, and
 * there's no separate permission carved out for generation-only.
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
import { enqueueAndGenerate } from "@/lib/content-engine/queue";
import { CONTENT_QUEUE_STATUSES, type ContentQueueStatus } from "@/lib/frontend/admin-content-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 280;

const QUEUE_SELECT =
  "id,character_id,content_type,status,prompt_input,result_text,result_url,triggered_by,moderation_category,error,cost_usd,created_at,completed_at,reviewed_by,reviewed_at,characters:character_id(name,image_url)";

// Shape of a QUEUE_SELECT row. supabase-js types nested-relation selects
// (`characters:character_id(...)`) as `any` by default since it can't infer
// the joined shape from the select string; this local interface restores
// type-checking on every field mapRow actually touches instead of letting
// `any` propagate through the whole handler (P1 type-safety cleanup).
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
    id: row.id,
    character_id: row.character_id,
    character_name: character?.name ?? "Unknown character",
    character_image_url: character?.image_url ?? null,
    content_type: row.content_type,
    status: row.status,
    prompt_input: row.prompt_input,
    result_text: row.result_text,
    result_url: row.result_url,
    triggered_by: row.triggered_by,
    moderation_category: row.moderation_category,
    error: row.error,
    cost_usd: row.cost_usd,
    created_at: row.created_at,
    completed_at: row.completed_at,
    reviewed_by: row.reviewed_by,
    reviewed_at: row.reviewed_at,
  };
}

export async function GET(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
    await requireAdmin(user.id);

    const params = req.nextUrl.searchParams;

    // Character picker for the "generate new content" panel — active,
    // approved characters only, same population the nightly cron rotates
    // over. Lives here (rather than a separate route) so the console's
    // client-side data layer stays to this one file, same as the
    // ?counts=1 sub-mode below.
    if (params.get("characters") === "1") {
      const { data } = await supabaseAdmin
        .from("characters")
        .select("id,name,image_url,lora_model_id,canon_sheet_url")
        .eq("active", true)
        .eq("moderation_status", "approved")
        .order("name", { ascending: true })
        .limit(500);

      return NextResponse.json({
        characters: (data ?? []).map((c) => ({
          id: c.id,
          name: c.name,
          image_url: c.image_url,
          has_lora: Boolean(c.lora_model_id),
          has_canon_sheet: Boolean(c.canon_sheet_url),
        })),
      });
    }

    if (params.get("counts") === "1") {
      const entries = await Promise.all(
        CONTENT_QUEUE_STATUSES.map(async (status) => {
          const { count } = await supabaseAdmin
            .from("character_content_queue")
            .select("id", { count: "exact", head: true })
            .eq("status", status);
          return [status, count ?? 0] as const;
        }),
      );
      return NextResponse.json({ counts: Object.fromEntries(entries) });
    }

    const rawStatus = params.get("status");
    const status: ContentQueueStatus | null =
      rawStatus && (CONTENT_QUEUE_STATUSES as readonly string[]).includes(rawStatus)
        ? (rawStatus as ContentQueueStatus)
        : null;

    const rawContentType = params.get("contentType");
    const contentType =
      rawContentType && ["image", "chat_line", "video"].includes(rawContentType) ? rawContentType : null;

    const characterId = params.get("characterId");
    const before = params.get("before");
    const limit = Math.min(Math.max(Number(params.get("limit") ?? 30), 1), 100);

    let query = supabaseAdmin
      .from("character_content_queue")
      .select(QUEUE_SELECT)
      .order("created_at", { ascending: false })
      .limit(limit + 1);

    if (status) query = query.eq("status", status);
    if (contentType) query = query.eq("content_type", contentType);
    if (characterId) query = query.eq("character_id", characterId);
    if (before) query = query.lt("created_at", before);

    const { data, error } = await query;
    if (error) throw error;

    const rows = data ?? [];
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    // TYPE-BOUNDARY FIX: QUEUE_SELECT's `characters:character_id(...)`
    // embed can't be resolved against the generated Database relationship
    // types here, so supabase-js falls back to unioning in its generic
    // GenericStringError row shape rather than the real one — mapRow()'s
    // own body already re-asserts every field individually for exactly
    // this reason (see its doc comment above); this cast just moves that
    // "trust the hand-written ContentQueueRow interface, the runtime
    // shape is known good" boundary to where the raw rows first arrive,
    // instead of leaving `.map(mapRow)` to trip over the inferred union.
    return NextResponse.json({ items: (page as unknown as ContentQueueRow[]).map(mapRow), hasMore });
  } catch (err) {
    logger.error("Admin content-queue GET error", errorLogFields(err));
    const status = err instanceof AppError ? err.statusCode : 500;
    return NextResponse.json(toErrorBody(err), { status });
  }
}

const postSchema = z.object({
  characterId: z.string().uuid(),
  contentType: z.enum(["image", "chat_line", "video"]),
  promptInput: z.string().max(500).optional(),
});

// Same ceiling api/cron/content-engine-video/route.ts uses: video polling
// capped well under the 280s function budget, leaving headroom for submit
// + R2 upload + DB writes. Image/chat-line generation ignores this (it's
// only read for content_type "video" — see EnqueueInput.maxWaitMs).
const VIDEO_POLL_MAX_WAIT_MS = 200_000;

export async function POST(req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
    await requireAdmin(user.id);
    await requirePermission(user.id, "content.publish");

    const parsed = postSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", code: "VALIDATION_ERROR", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { characterId, contentType, promptInput } = parsed.data;

    const { data: character } = await supabaseAdmin
      .from("characters")
      .select("id,name,lora_model_id,canon_sheet_url")
      .eq("id", characterId)
      .maybeSingle();

    if (!character) {
      return NextResponse.json({ error: "Character not found", code: "NOT_FOUND" }, { status: 404 });
    }
    if (contentType === "image" && !character.lora_model_id) {
      return NextResponse.json(
        { error: "Character has no trained LoRA — train one before generating images.", code: "VALIDATION_ERROR" },
        { status: 400 },
      );
    }
    if (contentType === "video" && !character.canon_sheet_url) {
      return NextResponse.json(
        { error: "Character has no canon reference sheet — generate one before requesting video.", code: "VALIDATION_ERROR" },
        { status: 400 },
      );
    }

    const result = await enqueueAndGenerate({
      characterId,
      contentType,
      triggeredBy: "admin",
      createdBy: user.id,
      promptInput,
      maxWaitMs: contentType === "video" ? VIDEO_POLL_MAX_WAIT_MS : undefined,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error ?? "Generation failed", code: "GENERATION_FAILED" }, { status: 502 });
    }

    await recordAdminAction({
      adminId: user.id,
      action: "content.generated",
      targetType: "content_queue_item",
      targetId: characterId,
      targetLabel: `${character.name} — ${contentType}`,
      metadata: { contentType, promptInput: promptInput ?? null },
    });

    // Re-fetch the freshly-written row for the client rather than hand-
    // assembling it from the generator's differently-shaped result union.
    const { data: row } = await supabaseAdmin
      .from("character_content_queue")
      .select(QUEUE_SELECT)
      .eq("character_id", characterId)
      .eq("content_type", contentType)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Same TYPE-BOUNDARY cast as the GET handler above, same reason
    // (QUEUE_SELECT's characters embed defeats the generated relationship
    // types) — see that comment for the full explanation.
    return NextResponse.json({ ok: true, item: row ? mapRow(row as unknown as ContentQueueRow) : null });
  } catch (err) {
    logger.error("Admin content-queue POST error", errorLogFields(err));
    const status = err instanceof AppError ? err.statusCode : 500;
    return NextResponse.json(toErrorBody(err), { status });
  }
}

import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const CONTENT_QUEUE_STATUSES = [
  "queued",
  "generating",
  "pending_review",
  "published",
  "rejected",
  "failed",
] as const;
export type ContentQueueStatus = (typeof CONTENT_QUEUE_STATUSES)[number];

export interface ContentQueueItem {
  id: string;
  character_id: string;
  character_name: string;
  character_image_url: string | null;
  content_type: "image" | "chat_line" | "video";
  status: ContentQueueStatus;
  prompt_input: string | null;
  result_text: string | null;
  result_url: string | null;
  triggered_by: "admin" | "cron";
  moderation_category: string | null;
  error: string | null;
  cost_usd: number | null;
  created_at: string;
  completed_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
}

const QUEUE_SELECT =
  "id,character_id,content_type,status,prompt_input,result_text,result_url,triggered_by," +
  "moderation_category,error,cost_usd,created_at,completed_at,reviewed_by,reviewed_at," +
  "characters:character_id(name,image_url)";

function mapRow(row: any): ContentQueueItem {
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

/**
 * SSR page-load snapshot: the pending_review queue (the tab an admin lands
 * on) plus per-status counts for the stat-card row. Everything else (other
 * status tabs, content_type filtering) is fetched client-side from
 * GET /api/admin/content-queue as the admin switches filters — see
 * admin-content-queue-client.ts. Mirrors getPendingCharacters()'s split for
 * /admin/characters: SSR the default view, client-fetch the rest.
 */
export async function getContentQueueSnapshot(): Promise<{
  items: ContentQueueItem[];
  counts: Record<ContentQueueStatus, number>;
}> {
  const [{ data: rows }, counts] = await Promise.all([
    supabaseAdmin
      .from("character_content_queue")
      .select(QUEUE_SELECT)
      .eq("status", "pending_review")
      .order("created_at", { ascending: false })
      .limit(50),
    loadStatusCounts(),
  ]);

  return { items: (rows ?? []).map(mapRow), counts };
}

/**
 * One head-count query per status rather than a single GROUP BY — the
 * supabase-js query builder has no aggregate/group-by escape hatch short
 * of a raw RPC, and six `count:'exact', head:true` queries against an
 * indexed (status) column is cheap on an admin-only page loaded
 * infrequently. Runs in parallel.
 */
async function loadStatusCounts(): Promise<Record<ContentQueueStatus, number>> {
  const entries = await Promise.all(
    CONTENT_QUEUE_STATUSES.map(async (status) => {
      const { count } = await supabaseAdmin
        .from("character_content_queue")
        .select("id", { count: "exact", head: true })
        .eq("status", status);
      return [status, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<ContentQueueStatus, number>;
}

export interface ContentQueueCharacter {
  id: string;
  name: string;
  image_url: string | null;
  /** Image generation requires a trained LoRA (generateCharacterImage's gate). */
  has_lora: boolean;
  /** Video generation requires a canon reference sheet (generateCharacterVideo's gate). */
  has_canon_sheet: boolean;
}

/**
 * Character picker for the "generate new content" panel. Only active,
 * approved characters — the same population the nightly cron rotates
 * over — so an admin can't queue content-engine runs for an
 * unapproved/inactive character.
 */
export async function getContentQueueCharacters(): Promise<ContentQueueCharacter[]> {
  const { data } = await supabaseAdmin
    .from("characters")
    .select("id,name,image_url,lora_model_id,canon_sheet_url")
    .eq("active", true)
    .eq("moderation_status", "approved")
    .order("name", { ascending: true })
    .limit(500);

  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    image_url: c.image_url,
    has_lora: Boolean(c.lora_model_id),
    has_canon_sheet: Boolean(c.canon_sheet_url),
  }));
}

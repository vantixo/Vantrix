import type { ContentQueueItem, ContentQueueStatus } from "@/lib/frontend/admin-content-queue";

export type { ContentQueueItem, ContentQueueStatus };

export interface FetchContentQueueParams {
  status?: ContentQueueStatus | "all";
  contentType?: "image" | "chat_line" | "video" | "all";
  characterId?: string;
  before?: string;
  limit?: number;
}

export async function fetchContentQueue(
  params: FetchContentQueueParams = {},
): Promise<{ items: ContentQueueItem[]; hasMore: boolean }> {
  const qs = new URLSearchParams();
  if (params.status && params.status !== "all") qs.set("status", params.status);
  if (params.contentType && params.contentType !== "all") qs.set("contentType", params.contentType);
  if (params.characterId) qs.set("characterId", params.characterId);
  if (params.before) qs.set("before", params.before);
  if (params.limit) qs.set("limit", String(params.limit));

  const res = await fetch(`/api/admin/content-queue?${qs.toString()}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Failed to load content queue");
  return { items: data.items ?? [], hasMore: Boolean(data.hasMore) };
}

export async function fetchContentQueueCounts(): Promise<Record<ContentQueueStatus, number>> {
  const res = await fetch("/api/admin/content-queue?counts=1&limit=1");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Failed to load queue counts");
  return data.counts;
}

export interface EnqueueContentInput {
  characterId: string;
  contentType: "image" | "chat_line" | "video";
  promptInput?: string;
}

export interface EnqueueContentResult {
  success: boolean;
  error?: string;
  item?: ContentQueueItem;
}

/**
 * POSTs to the enqueue route, which runs generation inline before
 * responding (see queue.ts's enqueueAndGenerate — no background worker
 * exists yet). Image/chat-line typically resolve in a few seconds; video
 * can take up to ~200s. Callers should show a persistent "generating…"
 * state rather than a short spinner.
 */
export async function enqueueContentGeneration(
  input: EnqueueContentInput,
): Promise<EnqueueContentResult> {
  const res = await fetch("/api/admin/content-queue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { success: false, error: data.error ?? "Generation failed" };
  return { success: true, item: data.item };
}

export type ReviewAction =
  | { action: "publish"; isPremium?: boolean; minTier?: string; displayOrder?: number; resultText?: string }
  | { action: "reject"; notes?: string }
  | { action: "retry" };

export async function reviewContentQueueItem(
  id: string,
  payload: ReviewAction,
): Promise<ContentQueueItem> {
  const res = await fetch(`/api/admin/content-queue/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Action failed");
  return data.item;
}

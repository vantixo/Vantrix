/**
 * Client-side fetch wrappers for the admin domain's review-queue routes.
 * All five safety queues (abuse-signals, crisis-events, reply-guard-flags,
 * keyword-watch-hits, revocation-flags) share the same GET ?status= /
 * PATCH {id,status,notes} shape — see the doc comments in each route —
 * so one generic pair of functions drives all of them, parameterized by
 * endpoint and response key rather than five near-duplicate modules.
 */

export interface AbuseSignal {
  id: string;
  created_at: string;
  kind: string;
  path: string;
  user_id: string | null;
  ip_hash: string | null;
  score: number;
  reasons: string[];
  user_agent: string | null;
  status: string;
  reviewed_by: string | null;
}

export interface CrisisEvent {
  id: string;
  created_at: string;
  user_id: string | null;
  character_id: string | null;
  conversation_id: string | null;
  category: string;
  message_excerpt: string;
  status: string;
  reviewer_notes: string | null;
}

export interface ReplyGuardFlag {
  id: string;
  created_at: string;
  user_id: string | null;
  character_id: string | null;
  category: string;
  blocked_excerpt: string;
  status: string;
}

export interface KeywordWatchHit {
  id: string;
  created_at: string;
  keyword_text: string;
  direction: "user_message" | "character_reply";
  user_id: string | null;
  character_id: string | null;
  excerpt: string;
  status: string;
}

export interface KeywordWatchlistEntry {
  id: string;
  created_at: string;
  keyword: string;
  is_regex: boolean;
  active: boolean;
  notes: string | null;
}

export interface UserReport {
  id: string;
  created_at: string;
  reporter_id: string;
  conversation_id: string | null;
  character_id: string | null;
  match_id: string | null;
  community_post_id: string | null;
  community_reply_id: string | null;
  category: string;
  detail: string | null;
  message_snippet: string | null;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
}

export interface RevocationFlag {
  id: string;
  created_at: string;
  user_id: string;
  provider: string;
  reason: "refund" | "dispute";
  status: "pending" | "cleared" | "executed";
  grace_period_ends_at: string;
}

async function fetchQueue<T>(endpoint: string, status: string): Promise<T[]> {
  const res = await fetch(`/api/admin/${endpoint}?status=${status}`);
  if (!res.ok) throw new Error(`Failed to load ${endpoint}`);
  const data = await res.json();
  // Each route's success key differs (signals/events/flags/hits) — return
  // whichever array-valued key is present rather than hardcoding one.
  const key = Object.keys(data).find((k) => Array.isArray(data[k]));
  return key ? data[key] : [];
}

async function patchQueueItem(
  endpoint: string,
  body: Record<string, unknown>
): Promise<void> {
  const res = await fetch(`/api/admin/${endpoint}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `Failed to update ${endpoint}`);
  }
}

export const fetchAbuseSignals = (status: string) =>
  fetchQueue<AbuseSignal>("abuse-signals", status);
export const reviewAbuseSignal = (id: string, status: string, notes?: string) =>
  patchQueueItem("abuse-signals", { id, status, notes });

export const fetchCrisisEvents = (status: string) =>
  fetchQueue<CrisisEvent>("crisis-events", status);
export const reviewCrisisEvent = (id: string, status: string, notes?: string) =>
  patchQueueItem("crisis-events", { id, status, notes });

export const fetchUserReports = (status: string) =>
  fetchQueue<UserReport>("user-reports", status);
// user_reports has no notes column (unlike crisis_events) — the third
// param is accepted only to match ReviewQueue's onReview signature and is
// never sent; see the route's patchSchema comment.
export const reviewUserReport = (id: string, status: string, _notes?: string) =>
  patchQueueItem("user-reports", { id, status });

export const fetchReplyGuardFlags = (status: string) =>
  fetchQueue<ReplyGuardFlag>("reply-guard-flags", status);
export const reviewReplyGuardFlag = (id: string, status: string, notes?: string) =>
  patchQueueItem("reply-guard-flags", { id, status, notes });

export const fetchKeywordWatchHits = (status: string) =>
  fetchQueue<KeywordWatchHit>("keyword-watch-hits", status);
export const reviewKeywordWatchHit = (id: string, status: string, notes?: string) =>
  patchQueueItem("keyword-watch-hits", { id, status, notes });

export const fetchRevocationFlags = (status: string) =>
  fetchQueue<RevocationFlag>("revocation-flags", status);
export const clearRevocationFlag = (flagId: string, reason?: string) =>
  patchQueueItem("revocation-flags", { flagId, reason });

export async function fetchKeywordWatchlist(): Promise<KeywordWatchlistEntry[]> {
  const res = await fetch("/api/admin/keyword-watchlist");
  if (!res.ok) throw new Error("Failed to load watchlist");
  const data = await res.json();
  return data.keywords ?? [];
}

export async function addKeyword(input: {
  keyword: string;
  isRegex?: boolean;
  notes?: string;
}): Promise<void> {
  const res = await fetch("/api/admin/keyword-watchlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Failed to add keyword");
  }
}

export async function toggleKeyword(id: string, active: boolean): Promise<void> {
  const res = await fetch("/api/admin/keyword-watchlist", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, active }),
  });
  if (!res.ok) throw new Error("Failed to toggle keyword");
}

export async function deleteKeyword(id: string): Promise<void> {
  const res = await fetch(`/api/admin/keyword-watchlist?id=${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete keyword");
}

export async function checkSuspension(
  userId: string
): Promise<boolean> {
  const res = await fetch(`/api/admin/suspensions?userId=${userId}`);
  if (!res.ok) throw new Error("Failed to check suspension");
  const data = await res.json();
  return Boolean(data.suspended);
}

export async function liftSuspension(userId: string): Promise<void> {
  const res = await fetch("/api/admin/suspensions", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) throw new Error("Failed to lift suspension");
}

/**
 * src/lib/push/send-push.ts
 *
 * Server-side Web Push (VAPID) sending. This is the "actually reaches the
 * user when they're not looking at the app" delivery path, complementary
 * to the in-app SSE stream at /api/notifications — that one only fires
 * while a tab is open and connected.
 *
 * Callers: cron jobs (nudges) and any server code that already has a
 * userId + message ready to go (character initiatives, surprise-engine
 * moments). Always uses supabaseAdmin — this never runs with a user's own
 * RLS-scoped client, since a single send fans out across every device a
 * user has subscribed from.
 *
 * Hardening/perf notes (see individual comments below):
 *   - sendPushToUsers does ONE batched subscription lookup for the whole
 *     fan-out instead of one query per user (was an N+1 for cron batches
 *     of up to hundreds of nudges).
 *   - All webpush.sendNotification calls run through a bounded concurrency
 *     pool (PUSH_CONCURRENCY), not a raw Promise.all — each call does real
 *     CPU work (ECDH + AES-GCM payload encryption per the Web Push crypto
 *     spec), and this app runs on constrained single-core instances, so an
 *     unbounded fan-out across hundreds of subscriptions can starve the
 *     event loop and every other request on the box.
 *   - Every push carries a TTL and urgency hint so undelivered
 *     notifications expire at the push service instead of queueing
 *     indefinitely, and title/body are hard-capped well under the Web
 *     Push 4KB payload ceiling.
 */
import webpush from 'web-push';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { env } from '@/env';

let vapidConfigured = false;

function ensureVapidConfigured(): boolean {
  if (vapidConfigured) return true;
  if (!env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    // Expected in local dev / any deploy that hasn't generated a VAPID
    // keypair yet — push sending just no-ops rather than throwing, same
    // pattern as the Resend/PostHog optional integrations elsewhere.
    return false;
  }
  webpush.setVapidDetails(
    env.VAPID_SUBJECT,
    env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY,
  );
  vapidConfigured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Path (not full URL) to open/focus on click, e.g. "/chat/abc123". */
  url?: string;
  /** Static icon shown in the notification; defaults to the app icon. */
  icon?: string;
  /** Dedup/collapse key — new pushes with the same tag replace the old one
   *  in the OS notification tray instead of stacking. */
  tag?: string;
  data?: Record<string, unknown>;
}

interface SendResult {
  sent: number;
  failed: number;
  invalidated: number;
}

// Hard caps well under the Web Push spec's 4KB payload ceiling — this is
// about notification UX (OSes truncate long titles/bodies anyway) and
// defense in depth against a caller accidentally interpolating something
// unbounded (e.g. raw AI-generated text) into a push payload.
const MAX_TITLE_LEN = 100;
const MAX_BODY_LEN = 180;

// Push services queue undelivered notifications for the sender-specified
// TTL, then drop them — without one, some services default to a very long
// window, which means a device that comes back online a week later gets a
// flood of stale "come chat" nudges. 24h comfortably covers "away for the
// day/overnight" while keeping anything shown meaningfully current.
const PUSH_TTL_SECONDS = 60 * 60 * 24;

// Bounded concurrency for the encryption + network work in
// webpush.sendNotification. Deliberately conservative for a 1-core /
// ~4GB box — see file header.
const PUSH_CONCURRENCY = 10;

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

function buildBody(payload: PushPayload): string {
  return JSON.stringify({
    title: truncate(payload.title, MAX_TITLE_LEN),
    body: truncate(payload.body, MAX_BODY_LEN),
    url: payload.url ?? '/',
    icon: payload.icon ?? '/icons/icon-192.png',
    tag: payload.tag,
    data: payload.data ?? {},
  });
}

type SubRow = { id: string; user_id: string; endpoint: string; p256dh: string; auth_key: string };

/** Runs `fn` over `items` with at most `limit` in flight at once. Never
 *  throws on individual item failure — `fn` is expected to catch its own
 *  errors (every call site here does). */
async function runWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const item = items[cursor++];
      await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** Sends one already-fetched subscription row, mutating `result` in place
 *  and best-effort updating last_seen_at / invalid_at as appropriate. */
async function dispatchOne(sub: SubRow, body: string, result: SendResult): Promise<void> {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
      body,
      { TTL: PUSH_TTL_SECONDS, urgency: 'normal' },
    );
    result.sent += 1;
    // Best-effort freshness ping — never let this fail the send.
    void supabaseAdmin
      .from('push_subscriptions')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', sub.id);
  } catch (err) {
    result.failed += 1;
    const statusCode = (err as { statusCode?: number })?.statusCode;
    // 404/410 = the push service has permanently discarded this
    // subscription (user revoked permission, uninstalled, endpoint rotated
    // out). Any other error (network blip, 5xx from the push service) is
    // transient — leave the subscription alone so the next send retries it.
    if (statusCode === 404 || statusCode === 410) {
      result.invalidated += 1;
      void supabaseAdmin
        .from('push_subscriptions')
        .update({ invalid_at: new Date().toISOString() })
        .eq('id', sub.id);
    } else {
      logger.warn('push:send:failed', { userId: sub.user_id, statusCode, error: String(err) });
    }
  }
}

/** Send a push notification to every active (non-invalidated) subscription
 *  for a user, across all of their devices. Safe to call even if push
 *  isn't configured (no-ops) or the user has zero subscriptions. */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<SendResult> {
  const result: SendResult = { sent: 0, failed: 0, invalidated: 0 };

  if (!ensureVapidConfigured()) return result;

  const { data: subs, error } = await supabaseAdmin
    .from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth_key')
    .eq('user_id', userId)
    .is('invalid_at', null);

  if (error) {
    logger.error('push:send:list-failed', { userId, error: error.message });
    return result;
  }
  if (!subs || subs.length === 0) return result;

  const body = buildBody(payload);
  await runWithConcurrency(subs, PUSH_CONCURRENCY, (sub) => dispatchOne(sub, body, result));

  return result;
}

/** Fan-out helper for cron jobs sending different payloads to many users
 *  at once (e.g. nudges — one payload per user, since the message is
 *  personalized). Does a single batched subscription lookup for every
 *  user in the list (not one query per user) and dispatches all resulting
 *  sends through one shared bounded-concurrency pool. Per-subscription
 *  failures never abort the batch. */
export async function sendPushToUsers(
  items: Array<{ userId: string; payload: PushPayload }>,
): Promise<SendResult> {
  const totals: SendResult = { sent: 0, failed: 0, invalidated: 0 };
  if (items.length === 0) return totals;
  if (!ensureVapidConfigured()) return totals;

  const userIds = [...new Set(items.map((i) => i.userId))];
  const { data: subs, error } = await supabaseAdmin
    .from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth_key')
    .in('user_id', userIds)
    .is('invalid_at', null);

  if (error) {
    logger.error('push:send-batch:list-failed', { userCount: userIds.length, error: error.message });
    return totals;
  }
  if (!subs || subs.length === 0) return totals;

  const subsByUser = new Map<string, SubRow[]>();
  for (const sub of subs) {
    const list = subsByUser.get(sub.user_id);
    if (list) list.push(sub);
    else subsByUser.set(sub.user_id, [sub]);
  }

  // Flatten to (subscription, pre-serialized payload) pairs so the whole
  // batch — across every user — shares one concurrency pool, instead of
  // each user's sendPushToUser call independently racing PUSH_CONCURRENCY
  // requests (which would multiply the real in-flight count by user count).
  const dispatchJobs: Array<{ sub: SubRow; body: string }> = [];
  for (const { userId, payload } of items) {
    const userSubs = subsByUser.get(userId);
    if (!userSubs || userSubs.length === 0) continue;
    const body = buildBody(payload);
    for (const sub of userSubs) dispatchJobs.push({ sub, body });
  }

  await runWithConcurrency(dispatchJobs, PUSH_CONCURRENCY, (job) => dispatchOne(job.sub, job.body, totals));

  return totals;
}

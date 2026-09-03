/**
 * Training data collection — first pass (inline, at message time).
 *
 * This is the FIRST of three redaction/filtering passes the data goes
 * through before it ever reaches Kaetah:
 *   1. HERE — inline, at write time (consent check + PII redaction).
 *   2. src/app/api/cron/training-data-export/route.ts — dedupe, quality
 *      filter, re-redaction, batching into JSONL shards, R2 upload.
 *   3. kaetah/post_training/sources/vantrix_chat_data.py — independent
 *      third redaction pass, kept deliberately separate so a regression in
 *      the Vantrix-side regex doesn't silently propagate into training data
 *      with nothing to catch it.
 *
 * Consent: queueForTraining() is a no-op unless profiles.training_data_consent
 * is true for the given user (see supabase/migrations/20260719_training_data_consent.sql).
 * Default is false — nothing is collected for a user who hasn't opted in.
 *
 * Storage: queued items land in a capped Redis list (training:queue). The
 * export cron drains it in batches. Capped so a stalled/broken cron can't
 * grow this unboundedly — oldest-in items are trimmed off if the cap is hit,
 * on the theory that a broken export pipeline should lose the tail of a
 * backlog rather than OOM Redis.
 */
import { redis }  from '@/lib/redis';
import { logger } from '@/lib/logger';
import { supabaseAdmin } from '@/lib/supabase/admin';

const QUEUE_KEY      = 'training:queue';
const QUEUE_MAX_LEN  = 50_000;

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}\b/g;
const URL_RE   = /https?:\/\/\S+/g;

/**
 * Kept intentionally independent from any similar redaction elsewhere in
 * the codebase (e.g. chat sanitize()) — this function's only job is to
 * strip contact-info-shaped patterns before content ever reaches the
 * training queue. Do not remove passes to "share" logic with an unrelated
 * sanitizer; see the module docstring on why the passes stay decoupled.
 */
function redact(text: string): string {
  return text
    .replace(EMAIL_RE, '[email]')
    .replace(URL_RE,   '[url]')
    .replace(PHONE_RE, '[phone]');
}

export interface TrainingMessage {
  role:    'user' | 'assistant';
  content: string;
}

// Small in-process cache so we don't hit Supabase on every single message —
// consent changes are rare and a few minutes of staleness here is fine
// (worst case: a handful of extra messages queued right after opt-out, which
// still get caught by export-time consent re-check, see the cron route).
const consentCache = new Map<string, { consent: boolean; expiresAt: number }>();
const CONSENT_CACHE_TTL_MS = 5 * 60 * 1000;

async function hasTrainingConsent(userId: string): Promise<boolean> {
  const cached = consentCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.consent;

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('training_data_consent')
    .eq('id', userId)
    .maybeSingle();

  const consent = !error && data?.training_data_consent === true;
  consentCache.set(userId, { consent, expiresAt: Date.now() + CONSENT_CACHE_TTL_MS });
  return consent;
}

/**
 * Queue one completed user/assistant exchange for potential training use.
 * No-op (and cheap — one cached consent check) unless the user has opted in.
 * Fire-and-forget from call sites: never let this block or fail a chat
 * response — swallow and log errors here.
 */
export async function queueForTraining(params: {
  userId:      string;
  characterId: string;
  userMessage: string;
  assistantReply: string;
}): Promise<void> {
  const { userId, characterId, userMessage, assistantReply } = params;

  try {
    if (!userMessage.trim() || !assistantReply.trim()) return;
    if (!(await hasTrainingConsent(userId))) return;

    const messages: TrainingMessage[] = [
      { role: 'user',      content: redact(userMessage) },
      { role: 'assistant', content: redact(assistantReply) },
    ];

    const record = {
      messages,
      // characterId (not userId) travels with the record — this is what
      // lets the export/training side build per-character SFT mixes for
      // "character building" rather than one undifferentiated blob.
      // No userId, name, or any other directly-identifying field included.
      characterId,
      queuedAt: new Date().toISOString(),
    };

    const pipe = redis.pipeline();
    pipe.lpush(QUEUE_KEY, JSON.stringify(record));
    pipe.ltrim(QUEUE_KEY, 0, QUEUE_MAX_LEN - 1);
    await pipe.exec();
  } catch (err) {
    // Never let a training-data hiccup affect the chat path.
    logger.warn('[training-queue] queueForTraining failed', { error: String(err) });
  }
}

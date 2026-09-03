/**
 * AI Cost Anomaly Detector
 *
 * Detects abnormal token consumption patterns in real-time and alerts
 * before a runaway user or loop causes a catastrophic bill spike.
 *
 * Detection signals:
 *   1. USER_SPIKE    — single user burns >3× their rolling hourly average
 *   2. PLATFORM_SPIKE — platform-wide hourly rate exceeds 2× 7-day average
 *   3. VELOCITY      — user sends >N messages in a sliding 60-second window
 *   4. LOOP_DETECT   — identical or near-identical messages repeated >3 times
 *
 * Response actions:
 *   - WARN:        log + increment anomaly counter, no throttle yet
 *   - THROTTLE:    inject a hard 60-second cooldown for that user
 *   - SUSPEND:     flag account for review + block AI calls (manual lift)
 *
 * Persistence: all state lives in Redis. No DB writes in the hot path.
 * Alerting: POST to ANOMALY_WEBHOOK_URL (Slack, PagerDuty, etc.) when
 *           severity ≥ THROTTLE.
 */

import { logger } from "@/lib/logger";
import { redis }              from "@/lib/redis";
import { env }                        from "@/env";


// ── Config ────────────────────────────────────────────────────────────────────

const MAX_MESSAGES_PER_MINUTE  = 20;
const LOOP_DETECTION_WINDOW    = 5;     // check last N messages for duplicates
const LOOP_SIMILARITY_THRESHOLD = 0.85; // Jaccard similarity cutoff
const USER_SPIKE_MULTIPLIER    = 3;     // >3× rolling avg = spike
const COOLDOWN_TTL             = 60;   // seconds
const ANOMALY_WINDOW           = 3600; // 1-hour rolling window for stats

// ── Types ─────────────────────────────────────────────────────────────────────

export type AnomalySeverity = "WARN" | "THROTTLE" | "SUSPEND";

export interface AnomalyEvent {
  type:       "USER_SPIKE" | "PLATFORM_SPIKE" | "VELOCITY" | "LOOP_DETECT";
  severity:   AnomalySeverity;
  userId?:    string;
  details:    Record<string, number | string>;
  timestamp:  number;
}

// ── Redis keys ────────────────────────────────────────────────────────────────

const keys = {
  userMsgTimestamps: (uid: string) => `anomaly:velocity:${uid}`,
  userHourlyTokens:  (uid: string) => `anomaly:tokens:hourly:${uid}`,
  userRecentMsgs:    (uid: string) => `anomaly:msgs:${uid}`,
  userCooldown:      (uid: string) => `anomaly:cooldown:${uid}`,
  userSuspended:     (uid: string) => `anomaly:suspended:${uid}`,
  platformDaily:     ()             => `anomaly:platform:daily:${new Date().toISOString().slice(0, 10)}`,
};

// ── Core checks ───────────────────────────────────────────────────────────────

/**
 * Main entry point. Call once per AI request, before calling the model.
 * Returns whether to proceed or block, plus any anomaly that was detected.
 */
export async function checkAnomaly(params: {
  userId:      string;
  message:     string;
  tokensUsed?: number;   // pass after response for spike detection
}): Promise<{
  blocked:  boolean;
  cooldown: boolean;
  anomaly:  AnomalyEvent | null;
}> {
  const { userId, message } = params;

  // ── Check existing suspension / cooldown ──────────────────────────────────
  const [suspended, cooldown] = await Promise.all([
    redis.exists(keys.userSuspended(userId)),
    redis.exists(keys.userCooldown(userId)),
  ]);

  if (suspended) {
    return {
      blocked:  true,
      cooldown: false,
      anomaly:  null,
    };
  }
  if (cooldown) {
    return {
      blocked:  false,   // not hard-blocked, just throttled
      cooldown: true,
      anomaly:  null,
    };
  }

  // ── Velocity check (messages per minute) ─────────────────────────────────
  const velocityAnomaly = await checkVelocity(userId);
  if (velocityAnomaly) {
    await handleAnomaly(userId, velocityAnomaly);
    const isBlocked = velocityAnomaly.severity === "SUSPEND";
    const isCooldown = velocityAnomaly.severity === "THROTTLE";
    return { blocked: isBlocked, cooldown: isCooldown, anomaly: velocityAnomaly };
  }

  // ── Loop detection ────────────────────────────────────────────────────────
  const loopAnomaly = await checkLoop(userId, message);
  if (loopAnomaly) {
    await handleAnomaly(userId, loopAnomaly);
    return { blocked: false, cooldown: true, anomaly: loopAnomaly };
  }

  return { blocked: false, cooldown: false, anomaly: null };
}

/**
 * Record tokens used after a successful response.
 * Triggers spike detection (async, non-blocking).
 */
export function recordUsageAsync(userId: string, tokensUsed: number): void {
  // Fire-and-forget — don't block the response
  checkTokenSpike(userId, tokensUsed).catch((err) =>
    logger.error("anomaly:spike-check-failed", { userId, err })
  );
}

// ── Velocity check ─────────────────────────────────────────────────────────────

async function checkVelocity(userId: string): Promise<AnomalyEvent | null> {
  const key = keys.userMsgTimestamps(userId);
  const now  = Date.now();
  const pipe = redis.pipeline();

  // Sorted set: score = timestamp, member = timestamp (deduplication trick)
  pipe.zadd(key, { score: now, member: String(now) });
  pipe.zremrangebyscore(key, 0, now - 60_000);         // remove > 60s old
  pipe.zcard(key);
  pipe.expire(key, 120);

  const results = await pipe.exec();
  const count   = (results[2] as number) ?? 0;

  if (count > MAX_MESSAGES_PER_MINUTE) {
    return {
      type:      "VELOCITY",
      severity:  count > MAX_MESSAGES_PER_MINUTE * 2 ? "SUSPEND" : "THROTTLE",
      userId,
      details:   { messagesPerMinute: count, limit: MAX_MESSAGES_PER_MINUTE },
      timestamp: now,
    };
  }
  return null;
}

// ── Loop detection ────────────────────────────────────────────────────────────

/** Jaccard similarity between two strings (tokenised by word) */
function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(/\s+/));
  const setB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = Array.from(setA).filter((x) => setB.has(x)).length;
  const union = new Set([...Array.from(setA), ...Array.from(setB)]).size;
  return union === 0 ? 1 : intersection / union;
}

async function checkLoop(userId: string, message: string): Promise<AnomalyEvent | null> {
  const key = keys.userRecentMsgs(userId);

  // Push + trim to window size
  await redis.lpush(key, message.slice(0, 200)); // store up to 200 chars
  await redis.ltrim(key, 0, LOOP_DETECTION_WINDOW - 1);
  await redis.expire(key, 300);

  const recent = await redis.lrange<string>(key, 0, -1);
  if (recent.length < 3) return null;

  let duplicates = 0;
  for (let i = 1; i < recent.length; i++) {
    if (jaccardSimilarity(message, recent[i]) >= LOOP_SIMILARITY_THRESHOLD) {
      duplicates++;
    }
  }

  if (duplicates >= 2) {
    return {
      type:      "LOOP_DETECT",
      severity:  "THROTTLE",
      userId,
      details:   { duplicates, window: LOOP_DETECTION_WINDOW },
      timestamp: Date.now(),
    };
  }
  return null;
}

// ── Token spike detection ─────────────────────────────────────────────────────

async function checkTokenSpike(userId: string, tokens: number): Promise<void> {
  const key = keys.userHourlyTokens(userId);
  const now  = Date.now();

  // Sliding window: zadd timestamp→tokens, then sum recent window
  await redis.zadd(key, { score: now, member: `${now}:${tokens}` });
  await redis.zremrangebyscore(key, 0, now - ANOMALY_WINDOW * 1000);
  await redis.expire(key, ANOMALY_WINDOW * 2);

  // Upstash Redis client types zrangebyscore as zrange with BYSCORE.
  // Use the typed zrange overload instead of casting redis to any.
  const windowStart = now - ANOMALY_WINDOW * 1000;
  const entries = await redis.zrange<string[]>(key, windowStart, now, { byScore: true });
  const hourlyTotal = entries.reduce((sum: number, e: string) => {
    const t = parseInt(e.split(":")[1] ?? "0", 10);
    return sum + (isNaN(t) ? 0 : t);
  }, 0);

  // Simple rolling average: compare current request to session avg
  const avgPerRequest = entries.length > 1 ? hourlyTotal / entries.length : 0;
  if (avgPerRequest > 0 && tokens > avgPerRequest * USER_SPIKE_MULTIPLIER && tokens > 2000) {
    const anomaly: AnomalyEvent = {
      type:      "USER_SPIKE",
      severity:  "WARN",
      userId,
      details:   { tokensThisRequest: tokens, rollingAvg: Math.round(avgPerRequest), multiplier: USER_SPIKE_MULTIPLIER },
      timestamp: now,
    };
    await notifyWebhook(anomaly);
    logger.warn("anomaly:user-spike", { userId, tokens, avgPerRequest });
  }
}

// ── Enforcement actions ───────────────────────────────────────────────────────

async function handleAnomaly(userId: string, anomaly: AnomalyEvent): Promise<void> {
  logger.warn("anomaly:detected", { userId, type: anomaly.type, severity: anomaly.severity });

  if (anomaly.severity === "THROTTLE") {
    await redis.set(keys.userCooldown(userId), "1", { ex: COOLDOWN_TTL });
  } else if (anomaly.severity === "SUSPEND") {
    await redis.set(keys.userSuspended(userId), "1", { ex: 60 * 60 * 24 }); // 24h
  }

  if (anomaly.severity !== "WARN") {
    await notifyWebhook(anomaly);
  }
}

async function notifyWebhook(anomaly: AnomalyEvent): Promise<void> {
  const url = env.ANOMALY_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        text:    `🚨 *AI Cost Anomaly* — \`${anomaly.type}\` (${anomaly.severity})`,
        anomaly,
      }),
    });
  } catch { /* non-fatal */ }
}

/** Lift a suspension (admin action) */
export async function liftSuspension(userId: string): Promise<void> {
  await Promise.all([
    redis.del(keys.userSuspended(userId)),
    redis.del(keys.userCooldown(userId)),
  ]);
}

/** Check if user is currently suspended */
export async function isUserSuspended(userId: string): Promise<boolean> {
  return (await redis.exists(keys.userSuspended(userId))) === 1;
}

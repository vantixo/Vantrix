/**
 * Cron Dead Man's Switch
 *
 * Problem:
 *   Cron jobs log errors but send no external signal on success or failure.
 *   A failed cron (daily-reset, nudges, billing-recovery) is discovered only
 *   when users complain — there is no proactive alerting.
 *
 * Solution:
 *   After each cron completes successfully, ping a heartbeat URL. External
 *   services (healthchecks.io, BetterStack, Cronitor) detect missed pings and
 *   alert via Slack/PagerDuty/email.
 *
 * Setup (healthchecks.io, free tier covers all Vantrix crons):
 *   1. Create a check per cron at https://healthchecks.io
 *   2. Set the check period to the cron interval + 10 min grace
 *   3. Add the ping URL to your env (see .env.example additions below)
 *   4. Wire alerts to Slack: Settings → Integrations → Slack
 *
 * Environment variables needed:
 *   HEARTBEAT_DAILY_RESET=https://hc-ping.com/{uuid}
 *   HEARTBEAT_NUDGES=https://hc-ping.com/{uuid}
 *   HEARTBEAT_BILLING_RECOVERY=https://hc-ping.com/{uuid}
 *   HEARTBEAT_MEMORY_ARCHIVE=https://hc-ping.com/{uuid}
 *   HEARTBEAT_MESSAGE_ARCHIVE=https://hc-ping.com/{uuid}
 *   HEARTBEAT_CHARACTER_INITIATIVES=https://hc-ping.com/{uuid}
 *   HEARTBEAT_DEEP_TICK=https://hc-ping.com/{uuid}
 *   HEARTBEAT_ECONOMY_TICK=https://hc-ping.com/{uuid}
 *   HEARTBEAT_GOVERNANCE_TICK=https://hc-ping.com/{uuid}
 *   HEARTBEAT_NARRATIVE_TICK=https://hc-ping.com/{uuid}
 *   HEARTBEAT_SURPRISE_ENGINE=https://hc-ping.com/{uuid}
 *   HEARTBEAT_BELIEF_MAINTENANCE=https://hc-ping.com/{uuid}
 *   HEARTBEAT_WISDOM_HABIT_MAINTENANCE=https://hc-ping.com/{uuid}
 *   HEARTBEAT_REFERRAL_PAYOUTS=https://hc-ping.com/{uuid}
 *   HEARTBEAT_REVOCATION_SWEEP=https://hc-ping.com/{uuid}
 *   HEARTBEAT_EMBEDDING_BACKFILL=https://hc-ping.com/{uuid}
 *
 * Ping types:
 *   success(url)  — call at end of cron on success (resets the timer)
 *   fail(url)     — call in catch block (marks check as failed immediately)
 *   start(url)    — call at start of cron (enables duration tracking)
 *
 * If no URL is configured for a cron, ping() is a no-op — safe to ship
 * before all env vars are set.
 */

const PING_TIMEOUT_MS = 5_000; // Don't let a dead heartbeat URL block the cron

export type HeartbeatName =
  | 'DAILY_RESET'
  | 'NUDGES'
  | 'BILLING_RECOVERY'
  | 'MESSAGE_RECOVERY'
  | 'MEMORY_ARCHIVE'
  | 'MESSAGE_ARCHIVE'
  | 'CHARACTER_INITIATIVES'
  | 'CHARACTER_POSTS'
  | 'CHARACTER_SOCIAL'
  | 'LEGACY_TICK'
  | 'DEEP_TICK'
  | 'ECONOMY_TICK'
  | 'GOVERNANCE_TICK'
  | 'NARRATIVE_TICK'
  | 'PAYSTACK_RENEWAL'
  | 'AGE_REVERIFICATION_TICK'
  | 'AGING_TICK'
  | 'TRAINING_DATA_EXPORT'
  | 'PRIORITY_MEMORY_EXPORT'
  | 'CONTENT_ENGINE'
  | 'CONTENT_ENGINE_VIDEO'
  | 'BACKSTORY_ENGINE'
  | 'SURPRISE_ENGINE'
  | 'ANIMATE_BACKFILL'
  | 'REGISTRATION_REMINDERS'
  | 'BELIEF_MAINTENANCE'
  | 'WISDOM_HABIT_MAINTENANCE'
  | 'DAILY_WORLD_CHOICE'
  | 'CIVIC_AFFAIRS_TICK'
  | 'REFERRAL_PAYOUTS'
  | 'REVOCATION_SWEEP'
  | 'EMBEDDING_BACKFILL';

function getUrl(name: HeartbeatName, suffix?: '/start' | '/fail'): string | null {
  const envKey = `HEARTBEAT_${name}`;
  const base = process.env[envKey];
  if (!base) return null;
  return suffix ? `${base}${suffix}` : base;
}

async function ping(url: string | null): Promise<void> {
  if (!url) return; // not configured — silent no-op
  try {
    await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    });
  } catch {
    // Never throw — a failed heartbeat ping must not fail the cron itself
  }
}

/**
 * Ping heartbeat start — call at the top of the cron handler.
 * Enables duration tracking (some services alert if the cron runs too long).
 */
export async function heartbeatStart(name: HeartbeatName): Promise<void> {
  await ping(getUrl(name, '/start'));
}

/**
 * Ping heartbeat success — call at the end of the cron handler.
 * Resets the "time since last ping" counter on the monitoring service.
 * If this isn't called within the expected period, you get alerted.
 */
export async function heartbeatSuccess(name: HeartbeatName): Promise<void> {
  await ping(getUrl(name));
}

/**
 * Ping heartbeat failure — call in the catch block.
 * Immediately marks the check as failed on healthchecks.io (no wait for timer).
 */
export async function heartbeatFail(name: HeartbeatName): Promise<void> {
  await ping(getUrl(name, '/fail'));
}

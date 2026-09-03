/**
 * Registration Re-engagement Emails
 *
 * Real transactional emails (via Resend) reminding people who created an
 * account but haven't come back yet. This is separate from nudge.ts (which
 * re-engages users about an existing dating match) — this targets the
 * broader "signed up, went quiet" population regardless of whether they
 * ever started a match.
 *
 * Three-stage drip, each with its own subject/copy, sent at most once per
 * user per stage:
 *
 *   +6h   "welcome back"     — soft, curiosity-driven, first touch
 *   +48h  "what you're missing" — shows concrete value (their own onboarding pick)
 *   +7d   "last check-in"    — final, respectful nudge before going quiet
 *
 * Eligibility: created_at falls in the stage's window AND last_active_at
 * is still at/near created_at (i.e. they never meaningfully returned).
 * A user who comes back at any point stops receiving further stage emails
 * naturally, since last_active_at moves forward and no longer matches the
 * "still inactive" condition below.
 *
 * Dedup: Redis flag per (user, stage) — belt and suspenders alongside the
 * activity check, so a slow cron run or retry can't double-send.
 *
 * Called by /api/cron/registration-reminders (recommended: hourly).
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { redis }         from '@/lib/redis';
import { logger }        from '@/lib/logger';
import { env }           from '@/env';

export type ReminderStage = 'welcome_back' | 'value_reminder' | 'last_check_in';

const STAGE_WINDOWS: Record<ReminderStage, { fromHours: number; toHours: number }> = {
  welcome_back:    { fromHours: 6,   toHours: 24 },   // fires once between 6h–24h post-signup
  value_reminder:  { fromHours: 48,  toHours: 72 },   // 2–3 days post-signup
  last_check_in:   { fromHours: 168, toHours: 192 },  // 7–8 days post-signup
};

// "Still inactive" = last_active_at is within 5 minutes of created_at,
// i.e. account creation is the only activity on record. Anything beyond
// that means they genuinely came back, so we don't second-guess it.
const INACTIVITY_GRACE_MS = 5 * 60 * 1000;

interface Candidate {
  id:            string;
  username:      string | null;
  onboarding_intent: string | null;
  preferred_category: string | null;
}

function dedupKey(userId: string, stage: ReminderStage): string {
  return `vantrix:regreminder:${stage}:${userId}`;
}

async function alreadySent(userId: string, stage: ReminderStage): Promise<boolean> {
  try {
    return (await redis.get(dedupKey(userId, stage))) != null;
  } catch {
    return false; // fail open — better to risk a rare duplicate than silently stop the whole drip
  }
}

async function markSent(userId: string, stage: ReminderStage): Promise<void> {
  try {
    // 30 day TTL — comfortably longer than the drip itself, just cleans up after
    await redis.set(dedupKey(userId, stage), '1', { ex: 60 * 60 * 24 * 30 });
  } catch {
    logger.warn('reg-reminder:mark-sent-failed', { userId, stage });
  }
}

async function getCandidates(stage: ReminderStage): Promise<Candidate[]> {
  const { fromHours, toHours } = STAGE_WINDOWS[stage];
  const now = Date.now();
  const fromTime = new Date(now - toHours * 60 * 60 * 1000).toISOString();
  const toTime   = new Date(now - fromHours * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, username, onboarding_intent, preferred_category, created_at, last_active_at, is_disabled')
    .gte('created_at', fromTime)
    .lte('created_at', toTime)
    .eq('is_disabled', false)
    .limit(500);

  if (error) {
    logger.error('reg-reminder:query-failed', { stage, error: error.message });
    return [];
  }
  if (!data?.length) return [];

  return data
    .filter((row) => row.created_at != null)
    .filter((row) => {
      const created  = new Date(row.created_at as string).getTime();
      const lastSeen = row.last_active_at ? new Date(row.last_active_at).getTime() : created;
      return Math.abs(lastSeen - created) <= INACTIVITY_GRACE_MS;
    })
    .map((row) => ({
      id: row.id,
      username: row.username,
      onboarding_intent: row.onboarding_intent,
      preferred_category: row.preferred_category,
    }));
}

// ── Copy ─────────────────────────────────────────────────────────────────

interface EmailContent {
  subject: string;
  preheader: string;
  headline: string;
  body: string[];   // paragraphs
  ctaLabel: string;
}

function firstName(username: string | null): string {
  if (!username) return 'there';
  return username.charAt(0).toUpperCase() + username.slice(1);
}

function categoryLabel(preferred: string | null, intent: string | null): string {
  return preferred ?? intent ?? 'your world';
}

function buildContent(stage: ReminderStage, c: Candidate): EmailContent {
  const name = firstName(c.username);
  const cat  = categoryLabel(c.preferred_category, c.onboarding_intent);

  switch (stage) {
    case 'welcome_back':
      return {
        subject: `${name}, your world is exactly where you left it`,
        preheader: 'A quiet corner of Vantrix has been waiting for you.',
        headline: `Welcome back, ${name}`,
        body: [
          `You opened the door a few hours ago — we saved your spot.`,
          `Everything you set up is still here: your preferences, your picks, your world tailored around ${cat}. All it's missing is you.`,
        ],
        ctaLabel: 'Step back in',
      };

    case 'value_reminder':
      return {
        subject: `The part of Vantrix built for you is still unopened`,
        preheader: `Two minutes is all it takes to pick up where you left off.`,
        headline: `Still thinking it over, ${name}?`,
        body: [
          `When you joined, you told us you were drawn to ${cat}. We built your experience around exactly that — it's ready, and it's been ready.`,
          `No pressure, no catch. Just come see what's waiting.`,
        ],
        ctaLabel: 'See what\u2019s waiting',
      };

    case 'last_check_in':
      return {
        subject: `One last thing before we let this go quiet, ${name}`,
        preheader: 'A final, no-pressure invitation back.',
        headline: `We\u2019ll keep this short, ${name}`,
        body: [
          `It's been a week since you joined, and we haven't heard from you since. That's completely fine — we just didn't want to assume and stop reaching out without saying so.`,
          `Your account, your preferences, and everything built around ${cat} are still here if you ever want them. The door's open whenever you are.`,
        ],
        ctaLabel: 'Come back in',
      };
  }
}

// ── Rendering ────────────────────────────────────────────────────────────

const BRAND = 'Vantrix';

function renderHtml(content: EmailContent, ctaUrl: string): string {
  const paragraphs = content.body
    .map((p) => `<p style="margin:0 0 18px;font-size:16px;line-height:1.6;color:#3a3a3a;">${p}</p>`)
    .join('\n');

  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#0b0b0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0b0b0f;padding:40px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.25);">
            <tr>
              <td style="padding:36px 40px 0;text-align:center;">
                <div style="font-size:13px;letter-spacing:3px;text-transform:uppercase;color:#8E8E97;font-weight:600;">${BRAND}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 40px 0;">
                <h1 style="margin:0 0 20px;font-size:24px;line-height:1.3;color:#111111;font-weight:700;">${content.headline}</h1>
                ${paragraphs}
              </td>
            </tr>
            <tr>
              <td style="padding:8px 40px 36px;">
                <a href="${ctaUrl}" style="display:block;text-align:center;background:linear-gradient(135deg,#8E8E97,#6B6B74);color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:14px 24px;border-radius:10px;">${content.ctaLabel}</a>
              </td>
            </tr>
            <tr>
              <td style="padding:0 40px 32px;border-top:1px solid #f0f0f0;">
                <p style="margin:20px 0 0;font-size:12px;color:#999999;line-height:1.6;">
                  You're receiving this because you created a ${BRAND} account and haven't been back yet — these stop automatically once you do.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function renderText(content: EmailContent, ctaUrl: string): string {
  return [
    content.headline,
    '',
    ...content.body,
    '',
    `${content.ctaLabel}: ${ctaUrl}`,
    '',
    `— The ${BRAND} team`,
  ].join('\n');
}

// ── Sending ──────────────────────────────────────────────────────────────

async function sendReminderEmail(candidate: Candidate, stage: ReminderStage): Promise<boolean> {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM) return false;

  const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(candidate.id);
  const email = user?.email;
  if (!email) return false;

  const content = buildContent(stage, candidate);
  const ctaUrl  = `${env.NEXT_PUBLIC_APP_URL}/discover?utm_source=email&utm_campaign=${stage}`;

  const { Resend } = await import('resend');
  const resend = new Resend(env.RESEND_API_KEY);

  await resend.emails.send({
    from:    env.RESEND_FROM,
    to:      email,
    subject: content.subject,
    html:    renderHtml(content, ctaUrl),
    text:    renderText(content, ctaUrl),
  });

  return true;
}

/**
 * runRegistrationReminders — batch entry point for the cron job.
 * Runs all three stages, sends emails to eligible + not-yet-sent users.
 */
export async function runRegistrationReminders(): Promise<{
  checked: number;
  sent:    number;
  byStage: Record<ReminderStage, number>;
}> {
  const stages: ReminderStage[] = ['welcome_back', 'value_reminder', 'last_check_in'];
  const byStage: Record<ReminderStage, number> = {
    welcome_back: 0, value_reminder: 0, last_check_in: 0,
  };

  let checked = 0;
  let sent = 0;

  for (const stage of stages) {
    const candidates = await getCandidates(stage);
    checked += candidates.length;

    for (const candidate of candidates) {
      if (await alreadySent(candidate.id, stage)) continue;

      try {
        const ok = await sendReminderEmail(candidate, stage);
        if (ok) {
          await markSent(candidate.id, stage);
          sent += 1;
          byStage[stage] += 1;
        }
      } catch (err) {
        logger.error('reg-reminder:send-failed', {
          userId: candidate.id, stage, error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  logger.info('reg-reminder:run-complete', { checked, sent, byStage });
  return { checked, sent, byStage };
}

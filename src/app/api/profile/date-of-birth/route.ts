/**
 * GET/PATCH /api/profile/date-of-birth
 *
 * Lets a signed-in user read and correct their recorded date of birth
 * after signup. Signup itself only asks once (see src/app/login/page.tsx,
 * sign-up mode); this is the re-entry point for a typo or a genuine
 * correction, surfaced on the Settings page.
 *
 * Both handlers go through age-gate.ts's existing submitSelfAttestation()/
 * getAgeVerification() rather than touching the `age_verifications` table
 * directly, so validation, the under-18 rejection path, and the
 * dob_changed audit trail all stay centralized in one place.
 *
 * Rate-limited (3 changes / 24h per user) — generous enough for a
 * legitimate correction, restrictive enough that this isn't a way to
 * repeatedly flip a recorded DOB. Adjust WINDOW/LIMIT below if that
 * cadence doesn't match your intended policy.
 *
 * Note: this route does not gate access to anything — see age-gate.ts's
 * header for the current state of age-verification enforcement in this
 * app. This only keeps the recorded value accurate and correctable.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Ratelimit }                 from '@upstash/ratelimit';
import { getAuthedUser }             from '@/lib/auth/get-authed-user';
import { redis }                     from '@/lib/redis';
import { logger }                    from '@/lib/logger';
import { z }                         from 'zod';
import {
  submitSelfAttestation,
  getAgeVerification,
  MINIMUM_AGE,
} from '@/lib/age-verification/age-gate';

export const dynamic = 'force-dynamic';

const dobUpdateLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(3, '24 h'),
  analytics: true,
  prefix: 'rl:dob-update',
});

// Reasonable bounds: no one still alive is credibly >130, and a DOB in the
// future or "today" can't compute a real age.
const MIN_DOB_YEAR = new Date().getFullYear() - 130;

const dobSchema = z.object({
  dateOfBirth: z.string().refine((v) => {
    const d = new Date(v);
    if (isNaN(d.getTime())) return false;
    if (d.getTime() >= Date.now()) return false;
    if (d.getFullYear() < MIN_DOB_YEAR) return false;
    return true;
  }, 'Enter a valid date of birth.'),
});

export async function GET() {
  const { user } = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const record = await getAgeVerification(user.id);
  return NextResponse.json({ ageVerification: record });
}

export async function PATCH(req: NextRequest) {
  const { user } = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { success } = await dobUpdateLimiter.limit(user.id);
  if (!success) {
    return NextResponse.json(
      { error: 'Too many date-of-birth changes. Please try again later.', code: 'RATE_LIMITED' },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = dobSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const result = await submitSelfAttestation(user.id, parsed.data.dateOfBirth, {
    ipAddress: ip,
    userAgent: req.headers.get('user-agent') ?? undefined,
  });

  if (result.status === 'rejected') {
    logger.info('profile:date-of-birth:rejected', { userId: user.id, minimumAge: MINIMUM_AGE });
    return NextResponse.json({ error: result.message, code: 'UNDER_MINIMUM_AGE' }, { status: 403 });
  }

  if (result.status === 'pending') {
    logger.info('profile:date-of-birth:pending_manual_review', { userId: user.id });
    return NextResponse.json({ error: result.message, code: 'PENDING_MANUAL_REVIEW' }, { status: 403 });
  }

  if (!result.isVerified) {
    return NextResponse.json({ error: result.message, code: 'UPDATE_FAILED' }, { status: 500 });
  }

  logger.info('profile:date-of-birth:updated', { userId: user.id });
  return NextResponse.json({ status: result.status, message: result.message });
}

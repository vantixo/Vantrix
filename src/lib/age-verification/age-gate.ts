// src/lib/age-verification/age-gate.ts
// ─────────────────────────────────────────────────────────────────────────────
// Signup-time age collection for Vantrix, with a settings-page re-entry
// point for corrections.
//
// Age is asked at signup (see src/app/login/page.tsx, sign-up mode) and
// recorded here via PATCH /api/profile/date-of-birth, and can also be
// corrected later from Settings (src/components/profile/settings-form.tsx,
// same route).
//
// Enforcement: src/lib/access/character-gate.ts's checkMatureContentAccess()
// calls the DB-backed is_user_age_verified(userId) guard, which is only
// true for status = 'verified'. A DOB that was previously rejected as
// under-18 can never flip straight back to 'verified' through this
// self-attestation endpoint — see the 'rejected' branch below, which
// routes any resubmission to 'pending' for manual review instead.
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import type { AgeVerificationStatus } from '@/types/age-verification';
import type { Json } from '@/types/supabase';

export const MINIMUM_AGE = 18;

// ── Age helpers ──────────────────────────────────────────────────────────────

export function computeAge(dateOfBirth: string, asOf: Date = new Date()): number {
  const dob = new Date(dateOfBirth);
  let age = asOf.getFullYear() - dob.getFullYear();
  const monthDiff = asOf.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && asOf.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

function isValidDate(value: string): boolean {
  const d = new Date(value);
  return !isNaN(d.getTime()) && d.getTime() < Date.now();
}

// ── Read ──────────────────────────────────────────────────────────────────────

export interface AgeVerificationRecord {
  status:        AgeVerificationStatus;
  dateOfBirth:   string | null;
  computedAge:   number | null;
  verifiedAt:    string | null;
  attemptCount:  number;
}

/**
 * Reads a user's currently-recorded age-verification state — for display
 * on a settings page, or for any other part of the app that wants to read
 * (not enforce against) a user's recorded age. Returns a default
 * "never submitted" shape rather than null/throwing, since the common
 * case for a route rendering a settings form is "show an empty DOB field",
 * not a special-cased error state.
 */
export async function getAgeVerification(userId: string): Promise<AgeVerificationRecord> {
  const { data, error } = await supabaseAdmin
    .from('age_verifications')
    .select('status,date_of_birth,computed_age_at_check,verified_at,attempt_count')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    logger.error('age_gate.getAgeVerification.failed', { userId, error: error.message });
  }

  return {
    status:       (data?.status as AgeVerificationStatus | undefined) ?? 'unverified',
    dateOfBirth:  data?.date_of_birth ?? null,
    computedAge:  data?.computed_age_at_check ?? null,
    verifiedAt:   data?.verified_at ?? null,
    attemptCount: data?.attempt_count ?? 0,
  };
}

// ── Self-attestation flow (signup, and later corrections) ───────────────────

/**
 * Records a DOB — either at signup (see auth/callback/page.tsx) or as a
 * later correction (see PATCH /api/profile/date-of-birth). Never throws —
 * returns a structured result. Not used as a content gate anywhere in the
 * app; this only records what the user entered.
 */
export async function submitSelfAttestation(
  userId: string,
  dateOfBirth: string,
  meta: { ipAddress?: string; userAgent?: string } = {}
): Promise<{ status: AgeVerificationStatus; isVerified: boolean; message: string }> {
  if (!isValidDate(dateOfBirth)) {
    return { status: 'rejected', isVerified: false, message: 'Invalid date of birth.' };
  }

  const age = computeAge(dateOfBirth);

  const { data: existing } = await supabaseAdmin
    .from('age_verifications')
    .select('date_of_birth, attempt_count, status')
    .eq('user_id', userId)
    .maybeSingle();

  // Detect DOB change after prior rejection — log it, never silently accept
  if (existing?.date_of_birth && existing.date_of_birth !== dateOfBirth) {
    await logAudit(userId, 'dob_changed',
      { date_of_birth: existing.date_of_birth },
      { date_of_birth: dateOfBirth },
      meta
    );
  }

  const attemptCount = ((existing?.attempt_count as number | null) ?? 0) + 1;

  // A prior rejection (self-attested under-18) must never be reversible
  // into 'verified' through this same self-attestation endpoint — that
  // would let a rejected minor simply retype a different DOB until one
  // computes to 18+, with only a 3-changes/24h rate limit standing in the
  // way. Once rejected, any further submission is routed to manual
  // 'pending' review instead of being auto-verified, regardless of the
  // age it computes to. Nothing else in the app treats 'pending' as
  // granting access (see is_user_age_verified(), which only accepts
  // 'verified'), so this cannot be used to self-approve.
  if (existing?.status === 'rejected') {
    await supabaseAdmin
      .from('age_verifications')
      .upsert({
        user_id:               userId,
        method:                'self_attestation',
        status:                'pending',
        date_of_birth:         dateOfBirth,
        computed_age_at_check: age,
        rejection_reason:      'Resubmission after prior rejection — requires manual review',
        attempt_count:         attemptCount,
        updated_at:            new Date().toISOString(),
      }, { onConflict: 'user_id' });

    await logAudit(userId, 'pending_manual_review', { date_of_birth: existing.date_of_birth }, { date_of_birth: dateOfBirth, age }, meta);

    return {
      status:     'pending',
      isVerified: false,
      message:    'Your previous age verification was rejected. This change requires manual review before your account can be re-verified.',
    };
  }

  if (age < MINIMUM_AGE) {
    await supabaseAdmin
      .from('age_verifications')
      .upsert({
        user_id:               userId,
        method:                'self_attestation',
        status:                'rejected',
        date_of_birth:         dateOfBirth,
        computed_age_at_check: age,
        rejection_reason:      'Computed age below minimum',
        attempt_count:         attemptCount,
        updated_at:            new Date().toISOString(),
      }, { onConflict: 'user_id' });

    await logAudit(userId, 'rejected', null, { age }, meta);

    return {
      status:     'rejected',
      isVerified: false,
      message:    'You must be 18 or older to use Vantrix.',
    };
  }

  const verifiedAt = new Date();

  const { error } = await supabaseAdmin
    .from('age_verifications')
    .upsert({
      user_id:               userId,
      method:                'self_attestation',
      status:                'verified',
      date_of_birth:         dateOfBirth,
      computed_age_at_check: age,
      rejection_reason:      null,
      attempt_count:         attemptCount,
      verified_at:           verifiedAt.toISOString(),
      expires_at:            null,
      updated_at:            verifiedAt.toISOString(),
    }, { onConflict: 'user_id' });

  if (error) {
    logger.error('age_gate.submitSelfAttestation.upsert_failed', { userId, error });
    return { status: 'unverified', isVerified: false, message: 'Verification failed. Please try again.' };
  }

  await logAudit(userId, 'verified', null, { age, method: 'self_attestation' }, meta);

  return { status: 'verified', isVerified: true, message: 'Age verified.' };
}

// ── Audit logging ────────────────────────────────────────────────────────────

async function logAudit(
  userId: string,
  eventType: string,
  oldValue: unknown,
  newValue: unknown,
  meta: { ipAddress?: string; userAgent?: string }
): Promise<void> {
  try {
    await supabaseAdmin.from('age_verification_audit').insert({
      user_id:    userId,
      event_type: eventType,
      old_value:  oldValue as unknown as Json,
      new_value:  newValue as unknown as Json,
      ip_address: meta.ipAddress ?? null,
      user_agent: meta.userAgent ?? null,
    });
  } catch (err) {
    // Never let audit logging block the main flow
    logger.error('age_gate.logAudit.failed', { userId, eventType, err });
  }
}

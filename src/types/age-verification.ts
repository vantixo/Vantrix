// Minimal type surface for the DOB record. Age is asked at signup (see
// auth/login/page.tsx + auth/callback/page.tsx) and can be corrected later
// via PATCH /api/profile/date-of-birth; both paths go through
// submitSelfAttestation() in lib/age-verification/age-gate.ts.
// is_user_age_verified(userId) (only true for status = 'verified') is the
// authoritative gate consumed by src/lib/access/character-gate.ts for
// mature content. A prior 'rejected' status can never be self-attested
// back into 'verified' — it can only move to 'pending' for manual review.

export type AgeVerificationStatus =
  | 'unverified'
  | 'pending'
  | 'verified'
  | 'rejected'
  | 'expired';

/**
 * Plan-gate authorization — ported from v20's requirePlan() middleware.
 *
 * Use this in API routes to lock features behind subscription tiers:
 *
 *   const profile = await requirePlan(userId, 'premium', 'Character creation');
 *
 * Throws PlanGateError (403) if the user's tier is below the requirement.
 */
import { supabaseAdmin }  from '@/lib/supabase/admin';
import { PlanGateError, UnauthorizedError } from '@/lib/errors';
import type { Tier }      from '@/lib/rate-limit';


/**
 * Verify the authenticated user meets the minimum plan tier.
 *
 * TWO-TIER MODEL: the product has exactly two tiers — free and premium.
 * Any minTier other than 'free' is treated as "requires premium". Only
 * 'free' (rank 0) ever fails a `minTier !== 'free'` check.
 *
 * Admins bypass via resolveEffectiveTier-equivalent logic: role/is_admin
 * always satisfies any gate, mirroring resolveEffectiveTier() in
 * rate-limit/index.ts so staff never get locked out of a feature they're
 * trying to test/support.
 *
 * B-04 fix: previously used the SSR `createClient()` from
 * `@/lib/supabase/server`, which requires a Next.js cookies() context.
 * Queue workers run outside the request lifecycle and have no cookie jar,
 * so any job calling requirePlan() (directly or transitively) would either
 * throw or silently return no user — bypassing the plan gate entirely.
 * `supabaseAdmin` needs no request context and works identically in both
 * API routes and background workers.
 *
 * @param userId   The authenticated user's ID
 * @param minTier  Minimum tier required. Any value other than 'free' is
 *                 treated as "requires premium" under the two-tier model.
 * @param feature  Human-readable feature name for the thrown error message.
 * @returns        The user's profile (select only the tier column)
 */
export async function requirePlan(
  userId: string,
  minTier: Tier,
  feature = 'This feature',
): Promise<{ tier: string }> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('tier, role, is_admin')
    .eq('id', userId)
    .single();

  if (error || !data) throw new UnauthorizedError('Profile not found');

  const isAdmin = data.role === 'admin' || data.is_admin === true;
  const requiresPremium = minTier !== 'free';
  const userIsPremium = normaliseTierForGate(data.tier) !== 'free';

  if (requiresPremium && !userIsPremium && !isAdmin) {
    throw new PlanGateError(feature, 'premium');
  }

  return data;
}

/** Two-tier check: 'free' minTier always passes; anything else requires the
 *  user's tier to be anything other than 'free' (or admin). */
export async function hasPlan(userId: string, minTier: Tier): Promise<boolean> {
  try {
    await requirePlan(userId, minTier);
    return true;
  } catch {
    return false;
  }
}

function normaliseTierForGate(raw: string | null | undefined): 'free' | 'premium' {
  return raw && raw.toLowerCase() !== 'free' ? 'premium' : 'free';
}

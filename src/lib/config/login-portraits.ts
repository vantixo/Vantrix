/**
 * Shared loader for the /login page's portrait collage.
 *
 * LOGIN-PORTRAITS-WIRE-FIX: this validation/fallback logic used to live
 * only inline in GET /api/config/login-portraits/route.ts. The page itself
 * (src/app/login/page.tsx) never rendered any portraits at all — the
 * collage described in this config's own migration/admin comments
 * (20261016_seed_login_portraits_config.sql, the loginPortraitSchema block
 * in api/admin/route.ts) referenced a src/app/auth/login/page.tsx that no
 * longer exists; the route moved to /login at some point and the portrait
 * UI was never carried over, leaving the backend (config row, public GET
 * route, admin editor) with no consumer. Extracted here so the page's
 * server component can call this directly — a Server Component reading its
 * own app's data via a self-fetch to /api/config/login-portraits would be
 * an unnecessary extra network round trip on the one page every signed-out
 * visitor has to load — while the public API route (kept for any future
 * client-side use) stays a thin wrapper over the same validated data,
 * instead of two copies of the validation logic drifting apart.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isSafeLocalImagePath, isSafeExternalUrl } from '@/lib/security';
import { isAllowedImageHost } from '@/lib/utils';
import { logger } from '@/lib/logger';

export interface LoginPortrait {
  src: string;
  alt: string;
}

// IMAGES-NOT-RENDERING FIX (2026-08-28): all four of these pointed at files
// that were never actually placed under public/images/characters/ — every
// signed-out /login visitor saw four broken-image icons, and this fallback
// (meant to be the safety net if the DB row is ever missing/invalid) was
// equally broken. Repointed at real, already-live character portraits; see
// 20261103_fix_broken_login_portraits.sql for the matching app_config fix.
export const FALLBACK_LOGIN_PORTRAITS: LoginPortrait[] = [
  { src: '/images/characters/lord-adrian-gallery-2.jpg', alt: '' },
  { src: '/images/characters/selene-dusk-gallery-1.jpg', alt: '' },
  { src: '/images/characters/valeria-storm-gallery-1.jpg', alt: '' },
  { src: '/images/characters/astra-nocturne-gallery-1.jpg', alt: '' },
];

function isValidPortrait(p: unknown): p is LoginPortrait {
  if (typeof p !== 'object' || p === null) return false;
  const { src, alt } = p as Record<string, unknown>;
  if (typeof src !== 'string' || typeof alt !== 'string') return false;
  if (isSafeLocalImagePath(src)) return true;
  if (!URL.canParse(src) || !isSafeExternalUrl(src)) return false;
  return isAllowedImageHost(new URL(src).hostname);
}

export async function getLoginPortraits(): Promise<LoginPortrait[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('app_config')
      .select('value')
      .eq('key', 'login_portraits')
      .maybeSingle();

    if (error || !data?.value) {
      return FALLBACK_LOGIN_PORTRAITS;
    }

    const parsed: unknown = JSON.parse(data.value);
    if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(isValidPortrait)) {
      logger.warn('login_portraits config invalid, using fallback', { value: data.value });
      return FALLBACK_LOGIN_PORTRAITS;
    }

    return parsed as LoginPortrait[];
  } catch (err) {
    logger.error('Failed to load login_portraits config', { err: String(err) });
    return FALLBACK_LOGIN_PORTRAITS;
  }
}

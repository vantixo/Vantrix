/**
 * Cookie Consent — shared types + storage helpers
 *
 * Categories:
 *   essential  — always on, not user-toggleable (auth session, CSRF, the
 *                consent choice itself — the app cannot function without
 *                these, so there's nothing to "reject" here)
 *   analytics  — usage/product analytics, off by default
 *   marketing  — ad personalization / attribution, off by default
 *
 * The choice is stored in a first-party cookie (not localStorage) so it's
 * readable server-side too — anything gating a server-set cookie (e.g. a
 * future analytics script tag) can check it during SSR instead of flashing
 * the tracker on for one paint before client JS catches up.
 */

export interface ConsentPreferences {
  essential:  true;      // always true — included for a complete, explicit record
  analytics:  boolean;
  marketing:  boolean;
}

export const CONSENT_COOKIE_NAME = 'vantrix-cookie-consent';
export const CONSENT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year
export const CONSENT_VERSION = 1; // bump if the categories/purpose text ever changes meaningfully

interface StoredConsent extends ConsentPreferences {
  version: number;
  decidedAt: string;
}

export function parseConsentCookie(raw: string | undefined | null): ConsentPreferences | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as StoredConsent;
    if (parsed.version !== CONSENT_VERSION) return null; // stale — re-prompt
    return { essential: true, analytics: !!parsed.analytics, marketing: !!parsed.marketing };
  } catch {
    return null;
  }
}

export function serializeConsent(prefs: Omit<ConsentPreferences, 'essential'>): string {
  const stored: StoredConsent = {
    essential: true,
    analytics: prefs.analytics,
    marketing: prefs.marketing,
    version: CONSENT_VERSION,
    decidedAt: new Date().toISOString(),
  };
  return encodeURIComponent(JSON.stringify(stored));
}

/** Client-side: read the current consent cookie, if any. */
export function getStoredConsent(): ConsentPreferences | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${CONSENT_COOKIE_NAME}=`));
  if (!match) return null;
  return parseConsentCookie(match.split('=').slice(1).join('='));
}

/** Client-side: persist a consent choice. */
export function setStoredConsent(prefs: Omit<ConsentPreferences, 'essential'>): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${CONSENT_COOKIE_NAME}=${serializeConsent(prefs)}; path=/; max-age=${CONSENT_COOKIE_MAX_AGE}; SameSite=Lax`;
  // Lets anything gated on consent (e.g. the analytics provider) react
  // immediately instead of only picking up the new choice on next page load.
  window.dispatchEvent(new CustomEvent('vantrix:consent-updated', { detail: { essential: true, ...prefs } }));
}

/**
 * hasConsent — the check any future non-essential script/cookie should make
 * before firing (e.g. `if (hasConsent('analytics')) loadAnalyticsScript()`).
 * No such script exists in the app yet, but this is the gate it should go
 * through when one is added, rather than loading unconditionally.
 */
export function hasConsent(category: keyof ConsentPreferences): boolean {
  if (category === 'essential') return true;
  return getStoredConsent()?.[category] === true;
}

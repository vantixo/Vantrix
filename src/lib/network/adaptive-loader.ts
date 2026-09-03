/**
 * Adaptive Network Loader — Vantrix Silicon Valley
 *
 * Detects connection quality and adjusts asset loading accordingly:
 *
 *   FAST (4G / WiFi in developed regions):
 *     - Full-res AVIF images with preloading
 *     - Prefetch next routes
 *     - No lazy loading (eager)
 *
 *   MEDIUM (3G / 4G in emerging markets):
 *     - WebP images, lazy loaded
 *     - Disabled prefetch
 *     - Reduced animation
 *
 *   SLOW (2G / EDGE / save-data):
 *     - Placeholder avatars, no background images
 *     - Text-only fallbacks for media-heavy components
 *     - Suspended preloads
 *
 * Works entirely client-side via the Network Information API + navigator.connection.
 * Falls back gracefully when the API is unsupported (most Safari versions).
 *
 * HOW IT WORKS:
 *   1. `getNetworkProfile()` reads navigator.connection to classify the connection.
 *   2. Components consume `useNetworkProfile()` hook to adapt rendering.
 *   3. `getOptimalImageProps()` returns the right Next/Image props for the profile.
 *   4. The CSS class `data-slow-network="true"` on <html> disables heavy animations.
 */

export type NetworkQuality = 'fast' | 'medium' | 'slow' | 'unknown';

export interface NetworkProfile {
  quality:      NetworkQuality;
  /** Raw effective type from Network Information API */
  effectiveType?: '2g' | '3g' | '4g' | 'slow-2g';
  /** Save-data preference */
  saveData:     boolean;
  /** Estimated downlink in Mbps */
  downlink?:    number;
  /** Whether to lazy-load images */
  lazyImages:   boolean;
  /** Whether to show full-resolution images */
  fullRes:      boolean;
  /** Whether to show animations */
  animations:   boolean;
  /** Whether to prefetch routes */
  prefetch:     boolean;
}

// ── Browser-side detection ────────────────────────────────────────────────────

type NavigatorConnection = {
  effectiveType?: '2g' | '3g' | '4g' | 'slow-2g';
  downlink?:      number;
  saveData?:      boolean;
  addEventListener?: (event: string, cb: () => void) => void;
  removeEventListener?: (event: string, cb: () => void) => void;
};

function getConnection(): NavigatorConnection | null {
  if (typeof navigator === 'undefined') return null;
  return (navigator as unknown as { connection?: NavigatorConnection }).connection ?? null;
}

export function getNetworkProfile(): NetworkProfile {
  const conn = getConnection();

  const saveData     = conn?.saveData ?? false;
  const effectiveType = conn?.effectiveType;
  const downlink      = conn?.downlink;

  // Save-data or explicit 2G → slow
  if (saveData || effectiveType === 'slow-2g' || effectiveType === '2g') {
    return {
      quality:     'slow',
      effectiveType,
      saveData,
      downlink,
      lazyImages:  true,
      fullRes:     false,
      animations:  false,
      prefetch:    false,
    };
  }

  // 3G or downlink < 1.5 Mbps → medium
  if (effectiveType === '3g' || (downlink !== undefined && downlink < 1.5)) {
    return {
      quality:     'medium',
      effectiveType,
      saveData,
      downlink,
      lazyImages:  true,
      fullRes:     false,
      animations:  true,
      prefetch:    false,
    };
  }

  // 4G or downlink ≥ 1.5 → fast (also covers unknown/null where we optimistically assume fast)
  if (effectiveType === '4g' || (downlink !== undefined && downlink >= 1.5)) {
    return {
      quality:     'fast',
      effectiveType,
      saveData,
      downlink,
      lazyImages:  false,
      fullRes:     true,
      animations:  true,
      prefetch:    true,
    };
  }

  // Truly unknown (API not supported — mostly Safari) — safe defaults
  return {
    quality:     'unknown',
    saveData:    false,
    lazyImages:  false,
    fullRes:     true,
    animations:  true,
    prefetch:    false, // don't prefetch when we don't know
  };
}

/**
 * Returns the optimal Next/Image loading props for the current network.
 * Use in any <Image> component that serves hero/avatar images.
 */
export function getOptimalImageProps(profile: NetworkProfile): {
  loading: 'lazy' | 'eager';
  quality: number;
  priority: boolean;
  unoptimized: boolean;
} {
  switch (profile.quality) {
    case 'slow':
      return { loading: 'lazy', quality: 50, priority: false, unoptimized: false };
    case 'medium':
      return { loading: 'lazy', quality: 70, priority: false, unoptimized: false };
    case 'fast':
      return { loading: 'eager', quality: 90, priority: true,  unoptimized: false };
    default:
      return { loading: 'lazy',  quality: 80, priority: false, unoptimized: false };
  }
}

/**
 * Apply slow-network class to <html> for CSS-level animation suppression.
 * Call this once in a layout-level useEffect.
 */
export function applyNetworkClass(profile: NetworkProfile): void {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  if (profile.quality === 'slow' || profile.saveData) {
    html.setAttribute('data-slow-network', 'true');
    html.classList.add('reduce-motion');
  } else {
    html.removeAttribute('data-slow-network');
    html.classList.remove('reduce-motion');
  }
}

/**
 * Subscribe to network quality changes.
 * Returns an unsubscribe function.
 */
export function onNetworkChange(cb: (profile: NetworkProfile) => void): () => void {
  const conn = getConnection();
  if (!conn?.addEventListener) return () => {};

  const handler = () => cb(getNetworkProfile());
  conn.addEventListener('change', handler);
  return () => conn.removeEventListener?.('change', handler);
}

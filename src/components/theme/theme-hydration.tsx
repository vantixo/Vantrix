"use client";

import { useEffect } from "react";
import { hydrateThemeStore } from "@/lib/theme/theme-store";

/**
 * Mounted once in the root layout, sibling to ServiceWorkerRegister /
 * AnalyticsPageview (same "no visual output, one-time side effect on
 * mount" pattern those use). Syncs useThemeStore with whatever
 * public/theme-init.js already set on <html data-theme> before paint, so
 * the toggle button's own label/icon can safely render theme-aware content
 * after this runs instead of guessing "gold" through the whole session.
 *
 * Does NOT set data-theme itself — theme-init.js already owns that, and
 * doing it twice risks a flash if this effect fires a tick later than the
 * blocking script already resolved.
 */
export function ThemeHydration() {
  useEffect(() => {
    hydrateThemeStore();
  }, []);

  return null;
}

/**
 * Loaded via next/script with strategy="beforeInteractive" in
 * src/app/layout.tsx. Runs before hydration/first paint so a returning
 * visitor who picked "nova", "velvet", or "aurora" never sees a flash
 * of the default gold theme.
 *
 * Must be a plain, dependency-free, same-origin static file (not an inline
 * <script>) — the CSP in middleware.ts only allows inline scripts that
 * carry the per-request nonce, and the root layout deliberately does NOT
 * read headers()/cookies() (that would force every route in the app,
 * including static marketing/SEO pages, into dynamic rendering just to
 * paint the right theme). A same-origin file matches CSP's `'self'`
 * without needing a nonce at all, so this works with zero server cost.
 *
 * Keep STORAGE_KEY, VALID_THEMES, and META_COLORS in sync with
 * src/lib/theme/constants.ts by hand — this file can't import TS.
 */
(function () {
  try {
    var STORAGE_KEY = "vantrix-theme";
    var VALID_THEMES = ["nova", "velvet", "aurora"]; // non-default themes only; "gold" needs no attribute
    var META_COLORS = { nova: "#0A0710", velvet: "#12080A", aurora: "#0D080F" };

    var value = window.localStorage.getItem(STORAGE_KEY);
    if (VALID_THEMES.indexOf(value) !== -1) {
      document.documentElement.setAttribute("data-theme", value);
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", META_COLORS[value]);
    }
    // Anything else (null, "gold", or a garbage value from a future
    // rollback) intentionally falls through to no attribute at all, which
    // is exactly what :root's default (gold) already covers.
  } catch (e) {
    // localStorage inaccessible (private mode / disabled storage) —
    // silently keep the default gold theme for this load.
  }
})();

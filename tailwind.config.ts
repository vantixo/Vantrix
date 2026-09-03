import type { Config } from "tailwindcss";

/**
 * Vantrix — Black & Gold theme tokens.
 *
 * Directive rule (see FRONTEND_DIRECTIVE §1): ONE background value,
 * everywhere. `bg-base` is the only surface color exposed for page, card,
 * modal, and nav backgrounds — there is deliberately no `surface-1` /
 * `surface-2` / `elevated` scale. Separation between elements comes from
 * `border-hairline` + spacing + shadow, never a lighter fill. Do not add a
 * second background color to this file; that's the rule eroding.
 *
 * Gold is a meaning color, not a decoration color — it only appears on
 * interactive or premium surfaces (buttons, active nav, focus rings, the
 * one accent word in a headline). Keep it out of large fills.
 *
 * ── Theming (added — see components/theme/) ────────────────────────────
 * `base`, the `gold` scale, `gold-fill`, `gold-edge`, and `gold-glow` below
 * are NOT literal colors anymore — each resolves through a CSS custom
 * property defined in app/globals.css (`:root` = this theme, "gold";
 * `[data-theme="nova"]` = the opt-in cosmic violet/magenta alternate).
 * Toggling `data-theme` on <html> re-skins every file that uses these
 * tokens with zero per-file edits — that's the whole point of routing
 * color through variables instead of hardcoding hex here. Everything else
 * in this file (border.*, text.*, danger, success, shadow.card/rail,
 * fonts, radii) is intentionally NOT themed; see globals.css's comment on
 * why only the accent scale + base earn that treatment. If you're tempted
 * to hardcode a hex value back into this file for `base`/`gold`/`gold-*`,
 * don't — it'll silently stop following the active theme, and
 * arch-15-gold-theme-is-default.test.ts / arch-theme-nova-system.test.ts
 * will fail.
 */
const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/hooks/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // The only background color in the system. Do not add siblings.
        // Theme-driven — see the ── Theming ── note above.
        base: "rgb(var(--color-base) / <alpha-value>)",

        border: {
          hairline: "rgba(255,255,255,0.08)",
          gold: "rgba(201,161,90,0.16)",
          // A11Y-FIX: rest-state border for actual form controls (input/
          // textarea) — NOT a replacement for border-hairline, which stays
          // untouched everywhere else (card/section/nav dividers). Those
          // are reinforced by spacing + shadow-card and aren't the sole
          // means of identifying a boundary, so they reasonably fall under
          // WCAG 1.4.11's exemption for decorative/non-essential graphics.
          // A form field's edge is a "UI Component" under 1.4.11 proper —
          // at border-hairline's 8% opacity it measures 1.19:1 against
          // bg-base, well under the 3:1 minimum, and unlike a card there's
          // no shadow/spacing cue to fall back on to see where the click/
          // type target actually starts. 34% white is the minimum opacity
          // that clears 3:1 (comes out to 3.01:1) — deliberately the least
          // change that satisfies the requirement, not a redesign.
          interactive: "rgba(255,255,255,0.34)",
        },

        // Theme-driven — see the ── Theming ── note above. Values below are
        // the CSS-var-wrapped equivalents of the original literal hex
        // (still the exact gold ramp under [data-theme] unset/"gold").
        gold: {
          50: "rgb(var(--gold-50) / <alpha-value>)",
          100: "rgb(var(--gold-100) / <alpha-value>)",
          200: "rgb(var(--gold-200) / <alpha-value>)",
          300: "rgb(var(--gold-300) / <alpha-value>)",
          400: "rgb(var(--gold-400) / <alpha-value>)",
          500: "rgb(var(--gold-500) / <alpha-value>)", // primary — CTA fill, active states
          600: "rgb(var(--gold-600) / <alpha-value>)", // pressed (gold) / muted (nova, see globals.css)
          700: "rgb(var(--gold-700) / <alpha-value>)",
          900: "rgb(var(--gold-900) / <alpha-value>)",
        },

        text: {
          primary: "#F5F5F4",
          secondary: "#9C9C9C",
          // A11Y-FIX: was #6B6B6B (3.72:1 on bg-base) — fails WCAG AA's
          // 4.5:1 minimum for normal-size text, and this token is used
          // at text-xs/text-sm across ~40 files (metadata, placeholders,
          // helper copy) — sizes too small to qualify for the 3:1
          // "large text" exemption. #808080 clears 4.5:1 with margin
          // (5.01:1) while staying visibly dimmer than text-secondary's
          // 7.21:1, preserving the primary > secondary > tertiary
          // hierarchy. See §7's own warning: "riskier for small metadata
          // text — verify per use, not just once globally."
          tertiary: "#808080",
        },

        danger: "#E5484D",
        success: "#4ADE80",
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        xs: "6px",
        sm: "10px",
        md: "14px",
        lg: "20px",
        xl: "28px",
      },
      boxShadow: {
        card: "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 12px 28px -16px rgba(0,0,0,0.7)",
        // Theme-driven — see the ── Theming ── note above.
        "gold-glow": "var(--gold-glow-shadow)",
        rail: "1px 0 0 0 rgba(255,255,255,0.08)",
      },
      backgroundImage: {
        // Theme-driven — see the ── Theming ── note above.
        "gold-edge": "var(--gold-edge-gradient)",
        "gold-fill": "var(--gold-fill-gradient)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-in-left": {
          from: { transform: "translateX(-100%)" },
          to: { transform: "translateX(0)" },
        },
        "slide-in-top": {
          from: { transform: "translateY(-100%)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        // IMMERSIVE-UI-PHASE-1: continuous idle "aliveness" loop for
        // singular character hero portraits (spec §13 "Character
        // Reactions" — a living-companion cue, not a one-time entrance).
        // transform-only (no width/height/layout properties), so this is
        // compositor-only and cheap even left running indefinitely —
        // see character-hero.tsx's own note on why this is scoped to
        // hero portraits and deliberately NOT applied to grid cards.
        breathe: {
          "0%, 100%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.015)" },
        },
      },
      animation: {
        "fade-in": "fade-in 200ms ease-out",
        "slide-in-left": "slide-in-left 200ms cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-in-top": "slide-in-top 260ms cubic-bezier(0.16, 1, 0.3, 1)",
        shimmer: "shimmer 2.4s linear infinite",
        breathe: "breathe 7s ease-in-out infinite",
      },
      transitionTimingFunction: {
        premium: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};

export default config;

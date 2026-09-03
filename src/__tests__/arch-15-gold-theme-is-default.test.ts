/**
 * ARCH-15 — Gold Is the Default Theme; No Uncontrolled Third Theme
 *
 * Fourth rewrite of this test. History:
 *   1. Original version asserted the *opposite* of the shipped spec (that
 *      gold had been removed for a rose/pink scale) and checked files that
 *      don't exist in this codebase — replaced.
 *   2. Second version asserted gold/black was the ONLY theme, full stop,
 *      with tailwind.config.ts hardcoding gold's hex literally and no
 *      `data-theme` mechanism existing at all. Its own docstring said:
 *      "If a real second accent is ever intentionally added ... update
 *      this test deliberately alongside that change — don't let it fail
 *      silently into 'expected.'" Nova (opt-in, cosmic violet/magenta)
 *      was added on exactly those terms, and the test was rewritten to
 *      match rather than left to rot.
 *   3. Third version: a third theme, "velvet" (opt-in, deep
 *      terracotta/rust — see globals.css's own comment on the
 *      companion/dating-specific color-psychology rationale), was added
 *      the same deliberate way.
 *   4. This version (the one you're reading): a fourth theme, "aurora"
 *      (opt-in, violet-to-warm-gold dusk — built for the Phase 1
 *      Immersive UI Upgrade's visual language brief), added the same
 *      deliberate way again. Per rewrite #2's own instruction, this test
 *      is updated again rather than loosened silently — the thing being
 *      guarded was never "at most one alternate," it was "every
 *      alternate goes through the CSS-variable mechanism and gets named
 *      here on purpose."
 *
 * What did NOT change, and what this file now guards instead:
 *   - Gold/black is still the *default* — a fresh visitor with no
 *     preference set sees byte-identical colors to before. `:root` in
 *     globals.css (theme unset / "gold") must still equal the exact
 *     original hex-as-RGB-triplet values.
 *   - There is still only ONE background surface token (`base`) and
 *     ONE accent scale (`gold` — the token name; see tailwind.config.ts's
 *     own "Theming" comment for why the semantic name didn't change even
 *     though its *value* now does under `[data-theme="nova"]`).
 *   - No component file hardcodes a banned Tailwind palette accent class
 *     (pink/rose/violet/etc.) — the new theme is implemented entirely via
 *     CSS custom properties swapped by a `data-theme` attribute, so zero
 *     component files needed to change to add it. If this check ever
 *     fails, someone added an uncontrolled accent rather than going
 *     through the CSS-variable mechanism — that's the thing to block,
 *     not the existence of "aurora" itself.
 *   - Exactly these three alternate theme blocks exist (nova, velvet,
 *     aurora) — not an open-ended per-user skin matrix. See constants.ts's
 *     own comment on why the old theme_skin/theme_accent columns aren't
 *     what this reuses.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

const ROOT_DIR = join(__dirname, '..', '..');
const SRC_DIR = join(ROOT_DIR, 'src');

function read(...parts: string[]): string {
  return readFileSync(join(ROOT_DIR, ...parts), 'utf-8');
}

/** Walk src/, skipping api/ (server-only route handlers have no UI/colors)
 *  and __tests__ itself, collecting .ts/.tsx/.css files to scan for classes. */
function walkSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === 'api' || entry === 'node_modules') continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walkSourceFiles(full, out);
    } else if (['.ts', '.tsx', '.css'].includes(extname(entry))) {
      out.push(full);
    }
  }
  return out;
}

// Matches e.g. bg-rose-500, text-pink-400, border-fuchsia-600/20, hover:from-violet-500
const BANNED_ACCENT_CLASS =
  /\b(?:bg|text|border|from|via|to|ring|fill|stroke|outline|accent|decoration|shadow)-(pink|rose|magenta|fuchsia|violet|purple|indigo)-\d{2,3}\b/;

describe('ARCH-15 — gold is the default theme, nova, velvet, and aurora are the only sanctioned alternates', () => {
  it('tailwind.config.ts exposes exactly one background surface color ("base"), theme-driven', () => {
    const config = read('tailwind.config.ts');
    const colorsBlock = config.match(/colors:\s*\{([\s\S]*?)\n\s{6}\},/)?.[1] ?? config;

    // Routed through the CSS variable, not a literal hex — that's what
    // makes it swappable. See globals.css for what the variable holds.
    expect(colorsBlock).toMatch(/base:\s*"rgb\(var\(--color-base\)\s*\/\s*<alpha-value>\)"/);

    // Guard against a second background surface ever being reintroduced.
    expect(colorsBlock).not.toMatch(/surface-?[12]?\s*:/i);
    expect(colorsBlock).not.toMatch(/elevated\s*:/i);
  });

  it('tailwind.config.ts defines the gold accent scale (theme-driven) and no competing accent scale key', () => {
    const config = read('tailwind.config.ts');

    expect(config).toMatch(/gold:\s*\{[\s\S]*?500:\s*"rgb\(var\(--gold-500\)\s*\/\s*<alpha-value>\)"/);

    // No rose/pink/vantrix-branded competing color scale block.
    expect(config).not.toMatch(/\b(rose|pink|vantrix|magenta|fuchsia)\s*:\s*\{/i);
  });

  it('no source file under src/ (excluding api/) uses a non-gold accent utility class', () => {
    const offenders: string[] = [];
    for (const file of walkSourceFiles(SRC_DIR)) {
      const contents = readFileSync(file, 'utf-8');
      if (BANNED_ACCENT_CLASS.test(contents)) {
        offenders.push(file.replace(ROOT_DIR + '/', ''));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('globals.css carries no second NEUTRAL background/surface custom property', () => {
    const css = read('src', 'app', 'globals.css');
    expect(css).not.toMatch(/--(color-)?surface/i);
    expect(css).not.toMatch(/--(color-)?rose/i);
    expect(css).not.toMatch(/--(color-)?pink/i);
  });

  it('the default (:root) theme values are byte-identical to the original gold spec', () => {
    const css = read('src', 'app', 'globals.css');
    const rootBlock = css.match(/:root\s*\{([\s\S]*?)\n\s{2}\}/)?.[1] ?? '';

    // These are the original literal hex values (#0A0A0A, #FAF3E4 ... #4A3714,
    // #C9A15A) as R,G,B triplets — a fresh visitor must still get exactly
    // this, whether or not the "nova" system exists.
    expect(rootBlock).toMatch(/--color-base:\s*10 10 10;/);
    expect(rootBlock).toMatch(/--gold-50:\s*250 243 228;/);
    expect(rootBlock).toMatch(/--gold-500:\s*201 161 90;/);
    expect(rootBlock).toMatch(/--gold-900:\s*74 55 20;/);
  });

  it('exactly these three alternate theme blocks exist ("nova", "velvet", "aurora") — not an open-ended skin matrix', () => {
    const css = read('src', 'app', 'globals.css');
    const themeBlocks = css.match(/\[data-theme="[a-z0-9-]+"\]/g) ?? [];
    const uniqueThemes = Array.from(new Set(themeBlocks));
    expect(uniqueThemes).toEqual(['[data-theme="nova"]', '[data-theme="velvet"]', '[data-theme="aurora"]']);
  });

  it("velvet's primary accent is hue-separated from the --danger token, not just darker", () => {
    const css = read('src', 'app', 'globals.css');
    const velvetBlock = css.match(/\[data-theme="velvet"\]\s*\{([\s\S]*?)\n\s{2}\}/)?.[1] ?? '';
    const primaryMatch = velvetBlock.match(/--gold-500:\s*(\d+)\s+(\d+)\s+(\d+);/);
    expect(primaryMatch).not.toBeNull();
    const [, r, g] = (primaryMatch ?? []).map(Number);

    const tailwindConfig = read('tailwind.config.ts');
    const dangerMatch = tailwindConfig.match(/danger:\s*"#([0-9a-fA-F]{6})"/);
    expect(dangerMatch).not.toBeNull();
    const dangerHex = (dangerMatch ?? [])[1] ?? 'E5484D';
    const dangerR = parseInt(dangerHex.slice(0, 2), 16);
    const dangerG = parseInt(dangerHex.slice(2, 4), 16);

    // Two colors this close in lightness/saturation are only safely
    // distinguishable if their hue actually differs — approximated here
    // via green:red ratio, which moves clearly (crimson/pink vs
    // terracotta/orange) even when raw channel values look superficially
    // similar. A prior version of this palette (cooler garnet-red) failed
    // this exact check before the fix described in globals.css.
    const velvetGtoR = g / r;
    const dangerGtoR = dangerG / dangerR;
    expect(velvetGtoR - dangerGtoR).toBeGreaterThan(0.1);
  });

  it("aurora's primary accent is hue-separated from the --danger token, not just darker", () => {
    // Same check as velvet's above, same reason: aurora's rose/mauge hue
    // sits on the warm side of the wheel near enough to --danger's red
    // that "looks distinct in the editor" isn't good enough — see
    // globals.css's own comment on how this ramp was actually computed,
    // not eyeballed.
    const css = read('src', 'app', 'globals.css');
    const auroraBlock = css.match(/\[data-theme="aurora"\]\s*\{([\s\S]*?)\n\s{2}\}/)?.[1] ?? '';
    const primaryMatch = auroraBlock.match(/--gold-500:\s*(\d+)\s+(\d+)\s+(\d+);/);
    expect(primaryMatch).not.toBeNull();
    const [, r, g] = (primaryMatch ?? []).map(Number);

    const tailwindConfig = read('tailwind.config.ts');
    const dangerMatch = tailwindConfig.match(/danger:\s*"#([0-9a-fA-F]{6})"/);
    expect(dangerMatch).not.toBeNull();
    const dangerHex = (dangerMatch ?? [])[1] ?? 'E5484D';
    const dangerR = parseInt(dangerHex.slice(0, 2), 16);
    const dangerG = parseInt(dangerHex.slice(2, 4), 16);

    const auroraGtoR = g / r;
    const dangerGtoR = dangerG / dangerR;
    expect(auroraGtoR - dangerGtoR).toBeGreaterThan(0.1);
  });
});

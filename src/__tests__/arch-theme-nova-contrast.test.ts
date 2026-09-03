/**
 * ARCH-THEME-NOVA-CONTRAST — WCAG AA guard for the nova accent ramp
 *
 * The gold ramp's own steps were hand-verified against WCAG AA at design
 * time (see tailwind.config.ts's A11Y-FIX comments on border.interactive
 * and text.tertiary — this codebase treats contrast as something to prove,
 * not assume). Nova needs the same guarantee: every step of the ramp
 * that's actually used as *text* against `base` in a real component today
 * (300, 400, 500, 600 — see sidebar.tsx / bottom-nav.tsx / mobile-drawer.tsx
 * / tier-card.tsx / milestone-toast.tsx) must clear 4.5:1, same as gold's
 * equivalent steps do. Reads globals.css directly rather than hardcoding
 * the RGB values here, so this fails loudly if the ramp is ever edited
 * without re-checking contrast — the same trap the text.tertiary A11Y-FIX
 * comment describes gold almost falling into.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT_DIR = join(__dirname, '..', '..');

function readGlobalsCss(): string {
  return readFileSync(join(ROOT_DIR, 'src', 'app', 'globals.css'), 'utf-8');
}

function extractThemeBlock(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\s{2}\\}`));
  if (!match) throw new Error(`Could not find ${selector} block in globals.css`);
  return match[1];
}

function extractTriplet(block: string, varName: string): [number, number, number] {
  const match = block.match(new RegExp(`--${varName}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+);`));
  if (!match) throw new Error(`Could not find --${varName} in block`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const chan = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

const WCAG_AA_NORMAL_TEXT = 4.5;

describe('ARCH-THEME-NOVA-CONTRAST — nova ramp clears WCAG AA where gold does', () => {
  const css = readGlobalsCss();
  const nova = extractThemeBlock(css, '[data-theme="nova"]');
  const novaBase = extractTriplet(nova, 'color-base');

  it.each([300, 400, 500, 600] as const)(
    'nova-%d clears 4.5:1 against nova\'s base when used as text',
    (step) => {
      const rgb = extractTriplet(nova, `gold-${step}`);
      const ratio = contrastRatio(rgb, novaBase);
      expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
    }
  );

  it('nova-500 clears 4.5:1 against the on-accent dark text color (#160F02) used on gold-fill/badges', () => {
    // Hardcoded to match the literal `text-[#160F02]` used across ~18
    // component files (button.tsx, badge.tsx, filter-pills.tsx, ...) for
    // text rendered directly on a gold-500/gold-fill background. Those
    // files were NOT changed to add nova (that's the point of the CSS-var
    // system) — so nova-500 has to keep working with that exact color.
    const onAccentDarkText: [number, number, number] = [22, 15, 2]; // #160F02
    const nova500 = extractTriplet(nova, 'gold-500');
    const ratio = contrastRatio(nova500, onAccentDarkText);
    expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
  });

  it('the default gold theme still clears the same bar (sanity check on the test itself)', () => {
    const root = extractThemeBlock(css, ':root');
    const goldBase = extractTriplet(root, 'color-base');
    for (const step of [300, 400, 500, 600] as const) {
      const rgb = extractTriplet(root, `gold-${step}`);
      expect(contrastRatio(rgb, goldBase)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
    }
  });
});

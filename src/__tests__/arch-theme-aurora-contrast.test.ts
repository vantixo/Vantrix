/**
 * ARCH-THEME-AURORA-CONTRAST — WCAG AA guard for the aurora accent ramp
 *
 * Same guarantee as arch-theme-nova-contrast.test.ts and
 * arch-theme-velvet-contrast.test.ts, for the fourth theme. Aurora's
 * ramp was computed (not hand-eyeballed) against this exact formula
 * before being written into globals.css, specifically because a warm
 * rose/magenta hue sits close enough to --danger on the wheel that it
 * needed real numbers, not a glance — see arch-15's aurora
 * hue-separation test for that other half of the same design problem.
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

describe('ARCH-THEME-AURORA-CONTRAST — aurora ramp clears WCAG AA where gold, nova, and velvet do', () => {
  const css = readGlobalsCss();
  const aurora = extractThemeBlock(css, '[data-theme="aurora"]');
  const auroraBase = extractTriplet(aurora, 'color-base');

  it.each([300, 400, 500, 600] as const)(
    "aurora-%d clears 4.5:1 against aurora's base when used as text",
    (step) => {
      const rgb = extractTriplet(aurora, `gold-${step}`);
      const ratio = contrastRatio(rgb, auroraBase);
      expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
    }
  );

  it('aurora-500 clears 4.5:1 against the on-accent dark text color (#160F02) used on gold-fill/badges', () => {
    // Same rationale as nova's and velvet's equivalent tests: button.tsx,
    // badge.tsx, filter-pills.tsx etc. render this literal dark text color
    // directly on a gold-500/gold-fill background and were never touched
    // to add aurora — so aurora-500 has to keep working with that exact color.
    const onAccentDarkText: [number, number, number] = [22, 15, 2]; // #160F02
    const aurora500 = extractTriplet(aurora, 'gold-500');
    const ratio = contrastRatio(aurora500, onAccentDarkText);
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

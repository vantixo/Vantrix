/**
 * ARCH-THEME-VELVET-CONTRAST — WCAG AA guard for the velvet accent ramp
 *
 * Same guarantee as arch-theme-nova-contrast.test.ts, for the third theme.
 * Not a redundant copy for its own sake: velvet's ramp went through a real
 * failed-then-fixed cycle during development that this test now guards
 * against regressing —
 *
 *   1. First pass used a cooler garnet-red (~191,74,58) for --gold-500.
 *      It cleared contrast fine, but sat close enough in *hue* to the
 *      --danger token (#E5484D) that a primary CTA and an error message
 *      looked like near-identical color at a glance. Fixed by shifting
 *      the whole ramp warmer/more orange (terracotta/rust) — see
 *      arch-15's dedicated hue-separation test for that guard.
 *   2. That same fix's first attempt at --gold-600 kept the "pressed /
 *      naturally darker" shape gold's own 600 uses, which measured under
 *      4.5:1 against velvet's base — because --gold-600 is reused as
 *      *text* in several components (sidebar active-state labels,
 *      tier-card, milestone-toast — same set nova's 600 covers), not
 *      just as a hover/press fill. Fixed the same way nova's 600 already
 *      does it: muted (lightened/desaturated) rather than darkened.
 *
 * Both fixes are guarded here numerically rather than left to "looked
 * fine in the picker" — the same trap the nova test's own header warns
 * about.
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

describe('ARCH-THEME-VELVET-CONTRAST — velvet ramp clears WCAG AA where gold and nova do', () => {
  const css = readGlobalsCss();
  const velvet = extractThemeBlock(css, '[data-theme="velvet"]');
  const velvetBase = extractTriplet(velvet, 'color-base');

  it.each([300, 400, 500, 600] as const)(
    "velvet-%d clears 4.5:1 against velvet's base when used as text",
    (step) => {
      const rgb = extractTriplet(velvet, `gold-${step}`);
      const ratio = contrastRatio(rgb, velvetBase);
      expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
    }
  );

  it('velvet-500 clears 4.5:1 against the on-accent dark text color (#160F02) used on gold-fill/badges', () => {
    // Same rationale as nova's equivalent test: button.tsx, badge.tsx,
    // filter-pills.tsx etc. render this literal dark text color directly
    // on a gold-500/gold-fill background and were never touched to add
    // velvet — so velvet-500 has to keep working with that exact color.
    const onAccentDarkText: [number, number, number] = [22, 15, 2]; // #160F02
    const velvet500 = extractTriplet(velvet, 'gold-500');
    const ratio = contrastRatio(velvet500, onAccentDarkText);
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

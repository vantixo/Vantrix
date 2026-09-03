/**
 * ARCH-THEME-NOVA-SYSTEM — the toggle is actually wired up
 *
 * The color-variable mechanism is covered by arch-15 (default unchanged)
 * and arch-theme-nova-contrast (ramp is accessible). This file guards the
 * *plumbing* around it: the storage key public/theme-init.js and
 * src/lib/theme/constants.ts must agree on (they can't share an import —
 * theme-init.js is a plain script, not a TS module, see its own comment),
 * and that the toggle button is actually mounted somewhere a visitor can
 * reach it, both signed in and signed out.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT_DIR = join(__dirname, '..', '..');

function read(...parts: string[]): string {
  return readFileSync(join(ROOT_DIR, ...parts), 'utf-8');
}

describe('ARCH-THEME-NOVA-SYSTEM — toggle plumbing', () => {
  it('theme-init.js and constants.ts agree on the localStorage key', () => {
    const constants = read('src', 'lib', 'theme', 'constants.ts');
    const initScript = read('public', 'theme-init.js');

    const constantsKey = constants.match(/THEME_STORAGE_KEY\s*=\s*"([^"]+)"/)?.[1];
    const scriptKey = initScript.match(/STORAGE_KEY\s*=\s*"([^"]+)"/)?.[1];

    expect(constantsKey).toBeDefined();
    expect(scriptKey).toBe(constantsKey);
  });

  it('constants.ts defines exactly four themes: gold (default), nova, velvet, and aurora', () => {
    const constants = read('src', 'lib', 'theme', 'constants.ts');
    expect(constants).toMatch(/THEMES\s*=\s*\["gold",\s*"nova",\s*"velvet",\s*"aurora"\]/);
    expect(constants).toMatch(/DEFAULT_THEME:\s*ThemeName\s*=\s*"gold"/);
  });

  it('root layout loads the beforeInteractive init script and mounts ThemeHydration', () => {
    const layout = read('src', 'app', 'layout.tsx');
    expect(layout).toMatch(/src="\/theme-init\.js"/);
    expect(layout).toMatch(/strategy="beforeInteractive"/);
    expect(layout).toMatch(/<ThemeHydration\s*\/>/);
  });

  it('the toggle is mounted in both the authenticated shell and the signed-out header', () => {
    const topBar = read('src', 'components', 'shell', 'top-bar.tsx');
    const publicHeader = read('src', 'components', 'public', 'public-header.tsx');
    expect(topBar).toMatch(/<ThemeToggle\s*\/>/);
    expect(publicHeader).toMatch(/<ThemeToggle\s*\/>/);
  });

  it('theme-init.js never writes to localStorage (read-only, no side effects before hydration)', () => {
    const initScript = read('public', 'theme-init.js');
    expect(initScript).not.toMatch(/localStorage\.setItem/);
  });
});

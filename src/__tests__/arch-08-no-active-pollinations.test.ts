/**
 * ARCH-08 — No Active Pollinations.ai Call Sites Anywhere
 *
 * Regression test for the full platform-wide Fal.ai migration. Six separate
 * code paths were found still constructing Pollinations.ai URLs directly:
 *   - chat/image, image-studio, images/generate-batch, characters/generate-image
 *     (all four generated a live Pollinations URL at request time)
 *   - the old seed-characters and backfill-images admin routes (seeded new
 *     characters with Pollinations URLs, or relocated existing Pollinations
 *     images to different storage without ever replacing them)
 *   - characters/route.ts's image_url host allowlist (would have accepted
 *     a NEW character submission pointing at Pollinations even after every
 *     generation path stopped producing them)
 *   - layout.tsx's dns-prefetch hint (harmless but stale once nothing
 *     fetches from Pollinations anymore)
 *
 * This checks the whole src tree for any *constructed* Pollinations URL
 * (i.e. `https://image.pollinations.ai/...` appearing outside a comment),
 * rather than checking each fixed file individually — the point is to catch
 * a NEW call site being added anywhere, not just regressions in files that
 * happened to be fixed already.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

const SRC_DIR = join(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === 'node_modules') continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (['.ts', '.tsx'].includes(extname(entry))) out.push(full);
  }
  return out;
}

function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('ARCH-08 — Pollinations.ai is never constructed as a live URL', () => {
  it('no file constructs a fetchable https://image.pollinations.ai/... URL outside a comment', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC_DIR)) {
      const code = readFileSync(file, 'utf-8');
      const active = stripComments(code);
      // Excludes the one legitimate pattern: .ilike('%pollinations.ai%') /
      // .or(...pollinations.ai%...) used to DETECT legacy data so it can be
      // migrated away from — that's a query filter, not a URL being built
      // to fetch or return. Anything else mentioning pollinations.ai in
      // active code is a real regression.
      const withoutDetectionFilter = active.replace(/ilike\.%pollinations\.ai%|['"`]%pollinations\.ai%['"`]/gi, '');
      if (/pollinations\.ai/i.test(withoutDetectionFilter)) {
        offenders.push(file.replace(SRC_DIR, 'src'));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the character image_url host allowlist no longer includes pollinations.ai', () => {
    const source = readFileSync(join(SRC_DIR, 'app', 'api', 'characters', 'route.ts'), 'utf-8');
    const allowlistBlock = source.match(/ALLOWED_IMAGE_HOSTS = new Set\(\[[\s\S]*?\]\)/)?.[0] ?? '';
    expect(allowlistBlock).not.toMatch(/pollinations/i);
  });
});

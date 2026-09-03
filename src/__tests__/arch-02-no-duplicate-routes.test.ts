/**
 * ARCH-02 — No Duplicate App Router Routes
 *
 * Regression test for a production-breaking bug: both `src/app/page.tsx`
 * and `src/app/(main)/page.tsx` resolved to the same URL ("/"), since route
 * groups like `(main)` are stripped from the URL path. Next.js silently
 * built both into the app-paths manifest without erroring, but at runtime
 * the route that actually got served threw:
 *
 *   Error [InvariantError]: Invariant: Expected clientReferenceManifest to
 *   be defined. This is a bug in Next.js.
 *
 * i.e. the homepage 500'd in production. `next build` and `next lint` do
 * NOT catch this — it only surfaces when the route is actually requested.
 *
 * This test statically resolves every page.tsx / route.ts under src/app to
 * its public URL (stripping route-group segments) and fails if two files
 * ever resolve to the same URL again.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'fs';
import { join, relative, dirname } from 'path';

const APP_DIR = join(__dirname, '..', 'app');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, out);
    } else if (entry === 'page.tsx' || entry === 'route.ts' || entry === 'route.tsx') {
      out.push(full);
    }
  }
  return out;
}

/** Strip Next.js route-group segments — e.g. "(main)" — which don't affect the URL. */
function toPublicUrl(filePath: string): string {
  const relDir = dirname(relative(APP_DIR, filePath));
  const segments = relDir
    .split('/')
    .filter((seg) => seg !== '.' && !(seg.startsWith('(') && seg.endsWith(')')));
  return '/' + segments.join('/');
}

describe('ARCH-02 — no two App Router files resolve to the same URL', () => {
  it('every page.tsx / route.ts under src/app maps to a unique public URL', () => {
    const files = walk(APP_DIR);
    expect(files.length).toBeGreaterThan(0);

    const byUrl = new Map<string, string[]>();
    for (const f of files) {
      const url = toPublicUrl(f);
      const list = byUrl.get(url) ?? [];
      list.push(relative(APP_DIR, f));
      byUrl.set(url, list);
    }

    const collisions = [...byUrl.entries()].filter(([, fs]) => fs.length > 1);

    if (collisions.length > 0) {
      const detail = collisions
        .map(([url, fs]) => `  "${url}" <- ${fs.join(' AND ')}`)
        .join('\n');
      throw new Error(
        `Duplicate App Router routes detected (these silently build but one ` +
        `will 500 at runtime):\n${detail}`
      );
    }

    expect(collisions).toHaveLength(0);
  });
});

/**
 * ARCH-05 — No Raw Postgres URL Ever Passed to createClient()
 *
 * Regression test for: supabasePool passed SUPABASE_DB_POOLER_URL (a raw
 * Postgres connection string, e.g.
 * postgres://user:pass@host.pooler.supabase.com:6543/postgres) directly into
 * @supabase/supabase-js's createClient(). createClient() always expects the
 * project's HTTPS REST endpoint — it has no code path that accepts a
 * Postgres connection string — so this threw on every request once
 * SUPABASE_DB_POOLER_URL was set:
 *
 *   Error: Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL.
 *
 * supabasePool had zero call sites anywhere in the app, so it was removed
 * rather than "fixed" into a real pooled-Postgres client (that would need
 * an actual Postgres driver, which isn't pulled into any feature today).
 *
 * Static source check, same approach as ARCH-02/03/04 — this is a runtime-
 * only failure (valid TypeScript, valid build) that only surfaces once the
 * env var happens to be set, so typecheck/build alone won't catch it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const adminSource = readFileSync(
  join(__dirname, '..', 'lib', 'supabase', 'admin.ts'),
  'utf-8'
);

describe('ARCH-05 — Supabase admin client never receives a non-HTTP(S) URL', () => {
  it('does not export a supabasePool (removed — see comment in admin.ts for why)', () => {
    expect(adminSource).not.toMatch(/export const supabasePool/);
  });

  it('does not reference SUPABASE_DB_POOLER_URL in actual code (comments may explain the history)', () => {
    const withoutComments = adminSource
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(withoutComments).not.toMatch(/SUPABASE_DB_POOLER_URL/);
  });

  it('the only createClient() call uses NEXT_PUBLIC_SUPABASE_URL', () => {
    // Strip comments first so prose mentioning "createClient()" doesn't false-match.
    const withoutComments = adminSource
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    const createClientCalls = withoutComments.match(/createClient\s*(<[^>]*>)?\s*\([\s\S]{0,120}/g) ?? [];
    expect(createClientCalls.length).toBeGreaterThan(0);
    for (const call of createClientCalls) {
      expect(call).toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
    }
  });

  it('SUPABASE_DB_POOLER_URL is not in the env schema (nothing left to consume it)', () => {
    const envSource = readFileSync(join(__dirname, '..', 'env.ts'), 'utf-8');
    expect(envSource).not.toMatch(/SUPABASE_DB_POOLER_URL/);
  });
});

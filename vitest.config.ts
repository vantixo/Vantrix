import { defineConfig, configDefaults } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // `server-only` throws unconditionally unless the bundler resolves the
      // "react-server" export condition (Next.js's webpack config does this;
      // vitest's plain Node resolution does not). That mismatch — not an app
      // bug — is what was causing "This module cannot be imported from a
      // Client Component module" at suite-load time for any test file that
      // transitively imports src/env.ts or src/lib/referral/engine.ts.
      // Tests run in Node, not the client, so the guard has nothing to
      // protect here; alias it to a no-op.
      'server-only': path.resolve(__dirname, './src/__tests__/__mocks__/server-only.ts'),
    },
  },
  test: {
    environment: 'node',
    // e2e/**/*.spec.ts are Playwright specs (import from '@playwright/test',
    // run by `npm run test:e2e`, never by vitest) — without this exclude,
    // vitest's default *.spec.ts glob picks them up too and they fail to
    // even load, since vitest's Node environment doesn't provide whatever
    // @playwright/test's `test`/`expect` need at import time.
    exclude: [...configDefaults.exclude, 'e2e/**'],
    env: {
      // provider-router.ts checks process.env[apiKeyEnv] directly (not the
      // Zod-validated/defaulted src/env.ts) so it can tell "unset" apart
      // from "set to a placeholder" — tests that exercise real moderation/
      // AI call paths (e.g. sec-04-moderation-fail-closed.test.ts, which
      // stubs global fetch itself) need a truthy value here or every
      // request is skipped as unconfigured before fetch is ever reached.
      OPENROUTER_API_KEY: 'sk-or-test-placeholder',
    },
  },
});

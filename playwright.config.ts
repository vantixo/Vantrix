import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config.
 *
 * Two auth states, kept as separate projects rather than one project with
 * conditional storageState, because a *valid* session cookie changes the
 * behavior under test: /login redirects away from itself once authed, so
 * the unauthenticated-redirect spec would silently start failing (or
 * silently start testing the wrong thing) if it ever inherited the
 * "authed" project's storage state. Splitting them makes that failure
 * mode structurally impossible instead of relying on nobody wiring a
 * dependency onto the wrong project later.
 *
 *   - "setup"        runs e2e/auth.setup.ts once, signs in through the
 *                     real UI (not an API shortcut — see that file's
 *                     header), saves storageState to e2e/.auth/user.json.
 *   - "unauthenticated" runs *.unauth.spec.ts with a clean context, no
 *                     dependency on setup.
 *   - "authenticated"   runs *.authed.spec.ts with storageState loaded
 *                     from setup's output, depends on "setup".
 *
 * Requires a real Supabase project + a seeded test user — see
 * e2e/auth.setup.ts's header and .env.example's "E2E testing" section.
 * Browser binaries also aren't installable in every sandbox (Playwright
 * downloads Chrome for Testing from cdn.playwright.dev at
 * `npx playwright install`) — CI installs them fresh each run; for local
 * runs, that host needs to be reachable.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  timeout: 30_000,

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "unauthenticated",
      testMatch: /.*\.unauth\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "authenticated",
      testMatch: /.*\.authed\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/user.json",
      },
      dependencies: ["setup"],
    },
  ],

  // CI builds the app itself (separate step, so a build failure is
  // reported as a build failure, not a confusing webServer timeout) and
  // then runs `next start` here. Locally, reuses whatever's already
  // running on the port (e.g. `npm run dev`) instead of starting a
  // second server.
  webServer: {
    command: "npm run start",
    url: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});

/**
 * ARCH-17 — E2E scaffold and CI workflow stay wired together
 *
 * Guards against three specific ways this quietly rots even though
 * `npm run test` (this suite) would keep passing on its own:
 *
 *   1. playwright.config.ts's "authenticated" project silently loses its
 *      dependency on "setup", or its storageState path drifts from what
 *      auth.setup.ts actually writes — either way, authenticated specs
 *      would start running against a browser with no session, and every
 *      assertion in authenticated-shell.authed.spec.ts would fail for
 *      the wrong reason (looks like an app bug, is actually a config
 *      drift).
 *   2. ci.yml's "e2e" job stops requiring "build", or the secret-gated
 *      skip (see ci.yml's header) silently starts covering the "verify"/
 *      "build" jobs too, which must never be conditional on optional
 *      secrets — those two prove typecheck/lint/unit-tests/build itself
 *      still work and can't legitimately be skipped by a missing E2E
 *      secret.
 *   3. e2e/*.unauth.spec.ts vs *.authed.spec.ts naming stops matching
 *      playwright.config.ts's testMatch regexes, silently dropping specs
 *      from every run (0 tests found still exits 0).
 *
 * This is deliberately structural/static, not a run of the specs
 * themselves — actually executing them needs a downloaded Chromium
 * binary (cdn.playwright.dev) and a live Supabase test project, neither
 * of which this suite can assume. `npx playwright test --list` is a
 * cheaper, browser-free way to confirm the config resolves at all; run
 * it by hand (or in CI) after touching any of these files.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..", "..");
const configSrc = readFileSync(join(ROOT, "playwright.config.ts"), "utf-8");
const ciSrc = readFileSync(
  join(ROOT, ".github", "workflows", "ci.yml"),
  "utf-8"
);

describe("ARCH-17 — playwright.config.ts", () => {
  it("declares all three projects: setup, unauthenticated, authenticated", () => {
    expect(configSrc).toMatch(/name:\s*"setup"/);
    expect(configSrc).toMatch(/name:\s*"unauthenticated"/);
    expect(configSrc).toMatch(/name:\s*"authenticated"/);
  });

  it("the authenticated project depends on setup and loads its storageState", () => {
    // Matches the "authenticated" project block specifically, not just
    // anywhere in the file, so this fails if the dependency/storageState
    // pair ever gets attached to the wrong project.
    const authedBlock = configSrc.slice(configSrc.indexOf('name: "authenticated"'));
    expect(authedBlock).toMatch(/dependencies:\s*\["setup"\]/);
    expect(authedBlock).toMatch(/storageState:\s*"e2e\/\.auth\/user\.json"/);
  });

  it("the storageState path matches what auth.setup.ts actually writes", () => {
    const setupSrc = readFileSync(join(ROOT, "e2e", "auth.setup.ts"), "utf-8");
    expect(setupSrc).toContain('path: "e2e/.auth/user.json"');
  });

  it("testMatch regexes correspond to the real spec-file naming convention", () => {
    expect(configSrc).toMatch(/testMatch:\s*\/.*\\\.unauth\\\.spec\\\.ts.*\//);
    expect(configSrc).toMatch(/testMatch:\s*\/.*\\\.authed\\\.spec\\\.ts.*\//);
    expect(existsSync(join(ROOT, "e2e", "specs", "auth-redirect.unauth.spec.ts"))).toBe(true);
    expect(existsSync(join(ROOT, "e2e", "specs", "authenticated-shell.authed.spec.ts"))).toBe(true);
  });
});

describe("ARCH-17 — ci.yml", () => {
  function jobBlock(name: string): string {
    const marker = `\n  ${name}:`;
    const start = ciSrc.indexOf(marker);
    expect(start, `job "${name}" not found in ci.yml`).toBeGreaterThan(-1);
    const rest = ciSrc.slice(start + 1);
    const nextJob = rest.slice(2).search(/\n {2}[a-zA-Z0-9_-]+:\n/);
    return nextJob === -1 ? rest : rest.slice(0, nextJob + 2);
  }

  it("has verify, build, e2e, and e2e-skip-notice jobs", () => {
    for (const name of ["verify", "build", "e2e", "e2e-skip-notice"]) {
      expect(ciSrc).toMatch(new RegExp(`\\n {2}${name}:\\n`));
    }
  });

  it("verify and build never skip based on E2E secrets", () => {
    expect(jobBlock("verify")).not.toMatch(/E2E_TEST_(EMAIL|PASSWORD)/);
    expect(jobBlock("build")).not.toMatch(/E2E_TEST_(EMAIL|PASSWORD)/);
  });

  it("build requires verify, and e2e requires build", () => {
    expect(jobBlock("build")).toMatch(/needs:\s*verify/);
    expect(jobBlock("e2e")).toMatch(/needs:\s*build/);
  });

  it("e2e and e2e-skip-notice conditions are complementary (exactly one runs)", () => {
    const e2e = jobBlock("e2e");
    const skip = jobBlock("e2e-skip-notice");
    expect(e2e).toMatch(/E2E_TEST_EMAIL.*!=\s*''/);
    // The skip-notice job must negate the same condition, not a
    // different/looser one, or both (or neither) could run.
    expect(skip).toContain(
      "!(secrets.E2E_TEST_EMAIL != '' && secrets.E2E_TEST_PASSWORD != '' && secrets.NEXT_PUBLIC_SUPABASE_URL != '')"
    );
  });

  it("e2e job installs a browser binary before running tests", () => {
    expect(jobBlock("e2e")).toMatch(/playwright install/);
  });
});

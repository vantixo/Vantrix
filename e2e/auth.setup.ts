import { test as setup, expect } from "@playwright/test";

/**
 * Runs once before the "authenticated" project's specs.
 *
 * Signs in through the actual /login form rather than seeding a session
 * via Supabase's admin API directly, on purpose: login-form.tsx carries
 * real product logic in front of the credential check (SEC-01's
 * open-redirect guard on `?redirect=`, the login-guard lockout check,
 * `ensureProfileAndAttribution()`), and a Supabase-only fast-path would
 * exercise none of it. That does mean this test is slower and doubles
 * as the sign-in smoke test.
 *
 * Requires:
 *   - A real Supabase project reachable at the app's configured
 *     NEXT_PUBLIC_SUPABASE_URL (this does not work against a mocked or
 *     offline backend — session cookies come from a real Supabase auth
 *     call).
 *   - A pre-existing, already-confirmed user in that project, with its
 *     credentials in E2E_TEST_EMAIL / E2E_TEST_PASSWORD. This setup does
 *     NOT sign up a fresh user each run (signup here would go through
 *     Supabase's "Confirm email" flow per login-form.tsx's own header
 *     comment, which nothing in this harness can click through) — the
 *     test user must be created and confirmed out-of-band once, e.g. in
 *     a dedicated Supabase project reserved for E2E so it never touches
 *     production data.
 *
 * See .env.example's "E2E testing" section for the full variable list.
 */

const email = process.env.E2E_TEST_EMAIL;
const password = process.env.E2E_TEST_PASSWORD;

setup("authenticate", async ({ page }) => {
  if (!email || !password) {
    throw new Error(
      "E2E_TEST_EMAIL and E2E_TEST_PASSWORD must be set to run the " +
        "authenticated" +
        " project — see .env.example's \"E2E testing\" section. The " +
        "unauthenticated" +
        " project's specs don't need these and can still run without them."
    );
  }

  await page.goto("/login");

  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("••••••••").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Successful sign-in lands on the authenticated shell's home ("/"),
  // which renders the sidebar nav — wait on that rather than the URL
  // alone, since a lingering error banner on /login (bad creds, locked
  // account) wouldn't necessarily change the URL immediately.
  await expect(page.getByRole("navigation").first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page).toHaveURL("/");

  await page.context().storageState({ path: "e2e/.auth/user.json" });
});

import { test, expect } from "@playwright/test";

/**
 * Runs with the storageState auth.setup.ts saved — requires
 * E2E_TEST_EMAIL/PASSWORD and a real Supabase test project (see that
 * file's header). If those aren't configured, the "setup" project fails
 * fast with a clear error and these specs never run.
 */

test("an authenticated visit to a protected route renders the app shell, not /login", async ({
  page,
}) => {
  await page.goto("/chats");
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole("navigation").first()).toBeVisible();
});

test("the signed-in home page does not show the logged-out CTA", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Log In" })).toHaveCount(0);
});

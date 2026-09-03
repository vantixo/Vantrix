import { test, expect } from "@playwright/test";

/**
 * Covers (app)/layout.tsx's signed-out redirect (see that file's "0.3.1
 * FIX" comment) and login-form.tsx's SEC-01 open-redirect guard.
 * Deliberately doesn't need E2E_TEST_EMAIL/PASSWORD or a seeded user —
 * this is the one spec safe to run even when no test Supabase project is
 * configured, so it's the fastest signal that routing/redirect logic
 * hasn't regressed.
 */

test("visiting a protected route while signed out redirects to /login", async ({
  page,
}) => {
  await page.goto("/chats");
  await expect(page).toHaveURL(/\/login/);
});

test("the redirect back-link is preserved as a same-origin path", async ({
  page,
}) => {
  await page.goto("/profile/settings");
  await expect(page).toHaveURL(/\/login\?redirect=%2Fprofile%2Fsettings/);
});

test("root path stays public and does not force a redirect", async ({
  page,
}) => {
  // (app)/layout.tsx's "0.3.1 FIX": "/" is exempt from the signed-out
  // redirect (unlike every other route in the group) so the logged-out
  // acquisition funnel has a landing step at all.
  await page.goto("/");
  await expect(page).toHaveURL("/");
  // PublicHeader (src/components/public/public-header.tsx) is what a
  // signed-out "/" actually renders per the layout's 0.3.1 FIX comment —
  // its CTA reads "Log In", not "Sign in" (that wording is specific to
  // the form's submit button on /login itself).
  await expect(page.getByRole("link", { name: "Log In" })).toBeVisible();
});

test("login page renders the sign-in form", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByPlaceholder("you@example.com")).toBeVisible();
  await expect(page.getByPlaceholder("••••••••")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

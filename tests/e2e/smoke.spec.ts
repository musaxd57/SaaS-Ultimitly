import { test, expect } from "@playwright/test";

// Minimal production-build smoke: the classes of breakage the unit suite can't
// see — "the app doesn't boot", "the landing 500s", "auth is broken end-to-end".
// Data comes from prisma/seed.ts (demo@guestops.ai / demo1234).

test("landing page boots and renders", async ({ page }) => {
  const res = await page.goto("/");
  expect(res?.status()).toBe(200);
  await expect(page.locator("body")).toContainText(/Lixus/i);
});

test("login → dashboard with the seeded owner", async ({ page }) => {
  await page.goto("/login");
  await page.fill("#email", "demo@guestops.ai");
  await page.fill("#password", "demo1234");
  await page.getByRole("button", { name: /giriş/i }).click();
  await page.waitForURL("**/dashboard", { timeout: 30_000 });
  // The app shell rendered with real session data (org name from the seed).
  await expect(page.locator("body")).toContainText(/Çıkış|Panel|Gösterge|Lixus/i);
});

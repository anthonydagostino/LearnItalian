import { expect, test } from "@playwright/test";
import { login, newDevice, waitSynced } from "./helpers";

test("an edit on one device shows up on another", async ({ page, browser }) => {
  await login(page);
  await page.getByRole("button", { name: /Log other practice/ }).click();
  await page.getByPlaceholder("What did you do?").fill("Podcast from device A");
  await page.getByRole("button", { name: /Log \d+ minute/ }).click();
  await waitSynced(page);

  const b = await newDevice(browser);
  await b.page.goto("/#/progress");
  await expect(b.page.locator(".hbar", { hasText: "Other" })).toBeVisible({ timeout: 15_000 });
  await b.ctx.close();
});

test("offline: the app opens, edits are kept, and they sync when back online", async ({ page, context, browser }) => {
  await login(page);
  await waitSynced(page);
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null && navigator.serviceWorker?.controller !== undefined, null, { timeout: 15_000 }).catch(() => {});
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText("Full day")).toBeVisible();
  await expect(page.getByText(/Offline/)).toBeVisible();
  await page.getByRole("button", { name: /Busy day/ }).click();
  await expect(page.locator(".plan-row")).toHaveCount(3);
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await waitSynced(page);

  const b = await newDevice(browser);
  await expect(b.page.locator(".plan-row")).toHaveCount(3, { timeout: 15_000 });
  await b.ctx.close();
});

test("settings persist across reloads and devices", async ({ page, browser }) => {
  await login(page);
  await page.goto("/#/settings");
  await page.getByLabel("New cards per day").fill("12");
  await waitSynced(page);
  await page.reload();
  await expect(page.getByLabel("New cards per day")).toHaveValue("12");
  const b = await newDevice(browser);
  await b.page.goto("/#/settings");
  await expect(b.page.getByLabel("New cards per day")).toHaveValue("12", { timeout: 15_000 });
  await b.ctx.close();
});

test("progress shows efficiency metrics and the path renders", async ({ page }) => {
  await login(page);
  await page.goto("/#/progress");
  await expect(page.getByText("words you can say")).toBeVisible();
  await expect(page.getByText("What to do about it")).toBeVisible();
  await page.goto("/#/path");
  await expect(page.locator(".path-node")).toHaveCount(10);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

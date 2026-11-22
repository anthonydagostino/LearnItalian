import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test.beforeEach(async ({ page }) => {
  await login(page);
  // Specs share one database; make sure today is on the full plan.
  await page.getByRole("button", { name: /Full day/ }).click();
  await expect(page.locator(".plan-row")).toHaveCount(6);
});

test("log a lesson, see it done, undo it", async ({ page }) => {
  await page.locator(".plan-row", { hasText: "Structured lesson" }).click();
  await page.getByRole("button", { name: /I finished lesson/ }).click();
  const row = page.locator(".plan-row", { hasText: "Structured lesson" });
  await expect(row).toHaveClass(/done/);
  page.once("dialog", (d) => d.accept());
  await row.click();
  await expect(row).not.toHaveClass(/done/);
});

test("double-tapping the log button records the time once", async ({ page }) => {
  await page.locator(".plan-row", { hasText: "Listening" }).click();
  const btn = page.getByRole("button", { name: /Log \d+ minute/ });
  await btn.dblclick();
  await expect(page.locator(".plan-row", { hasText: "Listening" })).toHaveClass(/done/);
  const logs = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const req = indexedDB.open("parla");
        req.onsuccess = () => {
          const all = req.result.transaction("docs").objectStore("docs").index("c").getAll("timelogs");
          all.onsuccess = () => resolve(all.result.filter((d: any) => !d.deleted && d.data.block === "listening").length);
        };
      }),
  );
  expect(logs).toBe(1);
});

test("busy day switches to the 30-minute plan", async ({ page }) => {
  await page.getByRole("button", { name: /Busy day/ }).click();
  await expect(page.locator(".plan-row")).toHaveCount(3);
  await page.getByRole("button", { name: /Full day/ }).click();
  await expect(page.locator(".plan-row")).toHaveCount(6);
});

test("tapping a running block continues it instead of restarting the timer", async ({ page }) => {
  await page.locator(".plan-row", { hasText: "Shadowing" }).click();
  await expect(page.locator(".timerbar")).toBeVisible();
  const started = await page.evaluate(() => JSON.parse(localStorage.getItem("parla.activeBlock")!).startedAt);
  await page.getByRole("link", { name: "Today" }).click();
  await page.waitForTimeout(50);
  await page.locator(".plan-row", { hasText: "Shadowing" }).click();
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem("parla.activeBlock")!).startedAt);
  expect(after).toBe(started);
  // Finishing logs it and clears the timer.
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: /Log \d+ minute/ }).click();
  await expect(page.locator(".timerbar")).toHaveCount(0);
});

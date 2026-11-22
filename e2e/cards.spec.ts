import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test.beforeEach(async ({ page }) => login(page));

test("production-first study session with two-button grading", async ({ page }) => {
  await page.getByRole("link", { name: "Cards" }).click();
  await page.getByRole("button", { name: /Study \d+ cards/ }).click();
  for (let i = 0; i < 5; i++) {
    await expect(page.locator(".study-tags")).toContainText("Say it in Italian");
    await page.getByRole("button", { name: "or just show me" }).click();
    await expect(page.locator(".grade")).toHaveCount(2);
    await page.locator(i === 0 ? ".grade.g1" : ".grade.g3").click();
  }
  // The "Forgot" card comes back later in the same session.
  await page.getByRole("button", { name: "End session" }).click();
  await expect(page.getByText(/to review|new words/).first()).toBeVisible();
});

test("leaving a session through the tab bar still logs its time", async ({ page }) => {
  await page.getByRole("link", { name: "Cards" }).click();
  await page.getByRole("button", { name: /Study \d+ cards/ }).click();
  await page.clock.install();
  await page.getByRole("button", { name: "or just show me" }).click();
  await page.locator(".grade.g3").click();
  await page.clock.fastForward("03:00");
  await page.getByRole("link", { name: "Today" }).click();
  await expect(page.getByText(/min added to today/)).toBeVisible();
});

test("drill runs start to finish", async ({ page }) => {
  await page.goto("/#/drill");
  for (let i = 0; i < 40; i++) {
    if (await page.getByText(/drill complete/i).isVisible()) break;
    const q = (await page.locator(".drill-q").textContent()) ?? "";
    if (q.includes("Say this")) {
      await page.getByRole("button", { name: "Can't speak right now" }).click();
      continue;
    }
    if (q.includes("Build")) await page.locator(".word-bank .word-tile").first().click();
    else await page.locator(".options .option").first().click();
    await page.locator(".check-bar button").click();
    await page.locator(".feedback-btn").click();
  }
  await expect(page.getByText(/drill complete/i)).toBeVisible();
});

test("browse: add a card and find it", async ({ page }) => {
  await page.goto("/#/cards?browse=1");
  await page.getByRole("button", { name: "+ Add card" }).click();
  await page.getByLabel("Italian", { exact: true }).fill("la scadenza");
  await page.getByLabel("English", { exact: true }).fill("the deadline");
  await page.getByRole("button", { name: "Save card" }).click();
  await page.getByPlaceholder(/Search/).fill("scadenza");
  await expect(page.locator(".list-item", { hasText: "la scadenza" })).toBeVisible();
});

import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test.beforeEach(async ({ page }) => login(page));

test("conversation: correction becomes a flashcard, help, summary with talk share", async ({ page }) => {
  await page.getByRole("link", { name: "Talk" }).click();
  await page.locator(".scenario-tile", { hasText: "Introducing myself" }).click();
  await expect(page.locator(".msg.assistant .it").first()).toContainText("Come ti chiami");
  await page.getByRole("button", { name: "Type" }).click();
  await page.getByPlaceholder("Scrivi in italiano…").fill("Ciao, mi chiamo Anthony e io sono 35 anni");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator(".correction")).toContainText("ho 35 anni");
  await expect(page.locator(".correction")).toContainText("In your flashcards");
  await page.getByRole("button", { name: "Help" }).click();
  await page.getByRole("button", { name: "Use this" }).click();
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByText("you talked")).toBeVisible();
  await page.goto("/#/cards?browse=1");
  await page.getByPlaceholder(/Search/).fill("35 anni");
  await expect(page.locator(".list-item")).toHaveCount(1);
});

test("double-tapping a scenario starts one conversation, not two", async ({ page, request }) => {
  await page.getByRole("link", { name: "Talk" }).click();
  const before = await countConversations(page);
  await page.locator(".scenario-tile", { hasText: "Ordering at a restaurant" }).dblclick();
  await expect(page.locator(".chat-head")).toBeVisible();
  expect(await countConversations(page)).toBe(before + 1);
  void request;
});

async function countConversations(page: import("@playwright/test").Page) {
  const r = await page.request.post("/api/sync", { data: { since: 0, changes: [] } });
  const body = await r.json();
  return body.changes.filter((c: any) => c.collection === "conversations").length;
}

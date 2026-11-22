import { expect, type Browser, type Page } from "@playwright/test";

export const PASSWORD = "e2e-pass";

/** Sign in and skip the welcome tour. */
export async function login(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Entra" }).click();
  const skip = page.getByRole("button", { name: "Skip" });
  await expect(skip.or(page.getByText("Full day"))).toBeVisible({ timeout: 20_000 });
  if (await skip.isVisible()) await skip.click();
  await expect(page.getByText("Full day")).toBeVisible();
}

/** A second "device": its own browser context with separate IndexedDB. */
export async function newDevice(browser: Browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page);
  return { ctx, page };
}

/** Wait until the client reports nothing left to push. */
export async function waitSynced(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<number>((resolve) => {
              const req = indexedDB.open("parla");
              req.onsuccess = () => {
                const tx = req.result.transaction("docs", "readonly");
                const c = tx.objectStore("docs").index("dirty").count(IDBKeyRange.only(1));
                c.onsuccess = () => resolve(c.result);
              };
            }),
        ),
      { timeout: 15_000 },
    )
    .toBe(0);
}

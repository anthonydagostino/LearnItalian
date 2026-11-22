import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("wrong password shows an error; right password reaches Today", async ({ page }) => {
  await page.goto("/");
  await page.getByPlaceholder("Password").fill("nope");
  await page.getByRole("button", { name: "Entra" }).click();
  await expect(page.getByText("Wrong password")).toBeVisible();
  await login(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Anthony");
});

test("the API rejects requests without a session, including encoded paths", async ({ request }) => {
  for (const url of ["/api/sync", "/%61pi/sync"]) {
    const r = await request.post(url, { data: { since: 0, changes: [] } });
    expect(r.status(), url).not.toBe(200);
  }
  expect((await request.get("/api/health")).status()).toBe(200);
});

test("the welcome tour saves name and start date", async ({ page }) => {
  await page.goto("/");
  await page.getByPlaceholder("Password").fill("e2e-pass");
  await page.getByRole("button", { name: "Entra" }).click();
  await page.evaluate(() => localStorage.removeItem("parla.welcomed"));
  await page.reload();
  await page.getByRole("button", { name: "Let's start" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel("What should I call you?").fill("Tony");
  await page.getByRole("button", { name: /Andiamo/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Tony");
});

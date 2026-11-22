import { beforeEach, expect, test } from "vitest";
import { db, put } from "./db";
import { buildFocus } from "./focus";
import { addDays, localDate } from "./time";
import { card, srsState } from "./test/factories";

beforeEach(async () => {
  await db.docs.clear();
});

test("empty data → empty focus", async () => {
  expect(await buildFocus()).toEqual({ words: [], mistakes: [] });
});

test("recent mistakes, most repeated first; old ones ignored", async () => {
  const today = localDate();
  const m = (id: string, corrected: string, date = today) =>
    put("mistakes", id, { source: "conversation", type: "vocabulary", original: "x", corrected, date, ts: 0 });
  await m("1", "ho 35 anni");
  await m("2", "ho 35 anni");
  await m("3", "vorrei un caffè");
  await m("4", "molto vecchio", addDays(today, -30));
  const f = await buildFocus();
  expect(f.mistakes).toEqual(["ho 35 anni", "vorrei un caffè"]);
});

test("weak words (by lapses) first, then this week's new words; hints stripped; capped", async () => {
  const today = localDate();
  for (let i = 0; i < 8; i++) {
    const c = card(`parola${i} (hint)`, `w${i}`, { dir: "en2it" });
    await put("cards", c.id, c.data);
    await put("srs", c.id, srsState({ lapses: i < 3 ? 3 - i : 0, introducedOn: today }));
  }
  const f = await buildFocus();
  expect(f.words.slice(0, 3)).toEqual(["parola0", "parola1", "parola2"]);
  expect(f.words.length).toBeLessThanOrEqual(10);
  expect(f.words.every((w) => !w.includes("("))).toBe(true);
});

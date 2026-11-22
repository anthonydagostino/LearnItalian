import { beforeEach, describe, expect, test, vi } from "vitest";
import { all, db, get } from "./db";
import { autoLog, elapsedMinutes, getActiveBlock, logTime, saveSettings, setActiveBlock, setDayMode } from "./state";
import { localDate } from "./time";
import type { DayplanData, TimelogData } from "./types";

beforeEach(async () => {
  await db.docs.clear();
  setActiveBlock(null);
});

describe("logTime", () => {
  test("writes a timelog and marks the plan block done", async () => {
    const id = await logTime({ block: "lesson", blockId: "lesson", minutes: 24.6, note: "LT 3" });
    const logs = await all<TimelogData>("timelogs");
    expect(logs).toHaveLength(1);
    expect(logs[0].data).toMatchObject({ block: "lesson", minutes: 25, note: "LT 3", date: localDate() });
    const plan = await get<DayplanData>("dayplans", localDate());
    expect(plan!.done.lesson).toBe(id);
    expect(plan!.mode).toBe("full");
  });
  test("negative minutes are clamped to 0; no blockId leaves the plan alone", async () => {
    await logTime({ block: "other", minutes: -10 });
    expect((await all<TimelogData>("timelogs"))[0].data.minutes).toBe(0);
    expect(await get("dayplans", localDate())).toBeUndefined();
  });
  test("logging to another date marks that date's plan", async () => {
    await logTime({ block: "tutor", blockId: "speaking", minutes: 50, date: "2026-12-03" });
    expect((await get<DayplanData>("dayplans", "2026-12-03"))!.done.speaking).toBeTruthy();
  });
});

test("setDayMode keeps blocks already done", async () => {
  await logTime({ block: "flashcards", blockId: "flashcards", minutes: 10 });
  await setDayMode(localDate(), "short");
  const p = await get<DayplanData>("dayplans", localDate());
  expect(p!.mode).toBe("short");
  expect(p!.done.flashcards).toBeTruthy();
});

test("saveSettings merges instead of replacing", async () => {
  await saveSettings({ newPerDay: 10 });
  await saveSettings({ reviewCap: 50 });
  expect(await get("settings", "main")).toEqual({ newPerDay: 10, reviewCap: 50 });
});

describe("active block timer", () => {
  test("persists to localStorage and survives a reload", () => {
    setActiveBlock({ kind: "speaking", label: "Speak", planned: 20, startedAt: 123, date: "2026-12-01", blockId: "speaking" });
    expect(JSON.parse(localStorage.getItem("parla.activeBlock")!).startedAt).toBe(123);
    setActiveBlock(null);
    expect(localStorage.getItem("parla.activeBlock")).toBeNull();
    expect(getActiveBlock()).toBeNull();
  });
  test("elapsedMinutes rounds and is at least 1", () => {
    const b = { kind: "speaking" as const, label: "", planned: 20, date: "", startedAt: Date.now() };
    expect(elapsedMinutes(b)).toBe(1);
    expect(elapsedMinutes({ ...b, startedAt: Date.now() - 7.6 * 60_000 })).toBe(8);
  });
  test("corrupt stored timers are ignored on load", async () => {
    for (const bad of ["{oops", "42", '{"kind":"speaking"}']) {
      localStorage.setItem("parla.activeBlock", bad);
      vi.resetModules();
      const fresh = await import("./state");
      expect(fresh.getActiveBlock()).toBeNull();
    }
    localStorage.removeItem("parla.activeBlock");
  });
});

describe("autoLog", () => {
  test("logs elapsed minutes when no timer is running", async () => {
    const m = await autoLog("flashcards", Date.now() - 4 * 60_000, "12 cards");
    expect(m).toBe(4);
    expect((await all<TimelogData>("timelogs"))[0].data).toMatchObject({ block: "flashcards", minutes: 4, note: "12 cards" });
  });
  test("under a minute logs nothing", async () => {
    expect(await autoLog("flashcards", Date.now() - 20_000, "x")).toBe(0);
    expect(await all("timelogs")).toHaveLength(0);
  });
  test("any running block timer suppresses it (no double counting, regression)", async () => {
    setActiveBlock({ kind: "speaking", label: "Speak", planned: 20, startedAt: Date.now(), date: localDate() });
    expect(await autoLog("flashcards", Date.now() - 10 * 60_000, "x")).toBe(0);
    expect(await all("timelogs")).toHaveLength(0);
  });
});

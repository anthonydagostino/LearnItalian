import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";
import { freshEnv } from "./helpers.js";

freshEnv();
const { importSeed } = await import("../seed.js");
const { buildApp } = await import("../index.js");
const { computeStats } = await import("../stats.js");
const { db, putDoc } = await import("../db.js");
const { addDays } = await import("../time.js");
importSeed();
const app = await buildApp();
after(() => app.close());

const START = "2026-11-23";
let n = 0;
const log = (date: string, minutes: number, block = "lesson") =>
  putDoc({ collection: "timelogs", id: `t${n++}`, data: { date, minutes, block }, updated_at: Date.now() });
const settings = (data: unknown) => putDoc({ collection: "settings", id: "main", data, updated_at: Date.now() + n++ });

beforeEach(() => {
  db.exec("DELETE FROM docs WHERE collection IN ('timelogs','settings','dayplans','mistakes','srs')");
});

describe("streak", () => {
  test("no logs → 0", () => assert.equal(computeStats("2026-12-01").streakDays, 0));

  test("counts consecutive days with ≥30 min, including today", () => {
    for (const d of ["2026-11-28", "2026-11-29", "2026-11-30"]) log(d, 30);
    assert.equal(computeStats("2026-11-30").streakDays, 3);
  });

  test("today under 30 min doesn't break yesterday's streak (yet)", () => {
    log("2026-11-29", 40);
    log("2026-11-30", 10);
    assert.equal(computeStats("2026-11-30").streakDays, 1);
    assert.equal(computeStats("2026-11-30").today.streakSafe, false);
  });

  test("a missed day resets it", () => {
    log("2026-11-27", 60);
    log("2026-11-29", 60);
    assert.equal(computeStats("2026-11-30").streakDays, 1);
    assert.equal(computeStats("2026-12-01").streakDays, 0);
  });

  test("29 minutes doesn't count; several short logs on one day add up", () => {
    log("2026-11-29", 29);
    assert.equal(computeStats("2026-11-29").streakDays, 0);
    log("2026-11-29", 1);
    assert.equal(computeStats("2026-11-29").streakDays, 1);
  });

  test("streaks span month and year boundaries", () => {
    for (let i = 0; i < 5; i++) log(addDays("2026-12-29", i), 30);
    assert.equal(computeStats("2027-01-02").streakDays, 5);
  });
});

describe("hours and weeks", () => {
  test("totals, speaking minutes (speaking + tutor) and per-week hours", () => {
    log(START, 60, "speaking");
    log(addDays(START, 1), 30, "tutor");
    log(addDays(START, 7), 120, "lesson");
    const s = computeStats(addDays(START, 8));
    assert.equal(s.totalHours, 3.5);
    assert.equal(s.speakingMinutes, 90);
    assert.equal(s.weeks[0].hours, 1.5);
    assert.equal(s.weeks[1].hours, 2);
    assert.equal(s.curriculumWeek, 2);
    assert.equal(s.thisWeekHours, 2);
  });

  test("time logged before the start date counts toward week 1", () => {
    log("2026-11-20", 60);
    const s = computeStats("2026-11-21");
    assert.equal(s.curriculumWeek, 0);
    assert.equal(s.weeks[0].hours, 1);
    assert.equal(s.thisWeekHours, 1);
  });

  test("after the curriculum ends the week stays at the last week", () => {
    assert.equal(computeStats(addDays(START, 200)).curriculumWeek, 9);
    assert.equal(computeStats(addDays(START, 200)).daysUntilTarget, 0);
  });

  test("garbage timelogs are ignored or clamped", () => {
    putDoc({ collection: "timelogs", id: "bad1", data: null, updated_at: 1 });
    putDoc({ collection: "timelogs", id: "bad2", data: { date: "yesterday", minutes: 30 }, updated_at: 1 });
    putDoc({ collection: "timelogs", id: "bad3", data: { date: START, minutes: "abc" }, updated_at: 1 });
    putDoc({ collection: "timelogs", id: "bad4", data: { date: START, minutes: -50 }, updated_at: 1 });
    putDoc({ collection: "timelogs", id: "bad5", data: { date: START, minutes: 1e9 }, updated_at: 1 });
    const s = computeStats(START);
    assert.equal(s.totalHours, 24, "one absurd log is capped at a day");
  });
});

describe("settings are untrusted", () => {
  test("malformed dates and targets fall back to the curriculum", () => {
    for (const bad of [{ startDate: "oops", targetDate: 5, weeklyTargetHours: "x" }, { startDate: "2026-13-45" }, null, "str", { weeklyTargetHours: -3 }]) {
      settings(bad);
      const s = computeStats("2026-12-01");
      assert.equal(s.startDate, START);
      assert.equal(s.targetDate, "2027-01-26");
      assert.equal(s.weeklyTargetHours, 14);
    }
  });

  test("valid overrides are used", () => {
    settings({ startDate: "2026-12-07", targetDate: "2027-02-01", weeklyTargetHours: 10 });
    const s = computeStats("2026-12-14");
    assert.equal(s.curriculumWeek, 2);
    assert.equal(s.weeklyTargetHours, 10);
    assert.equal(s.daysUntilTarget, 49);
  });
});

describe("today", () => {
  test("full vs short plan, completion", () => {
    const day = addDays(START, 2);
    putDoc({ collection: "dayplans", id: day, data: { mode: "short", done: { flashcards: "x", speaking: "y", shadowing: "z" } }, updated_at: 1 });
    let s = computeStats(day);
    assert.equal(s.today.mode, "short");
    assert.equal(s.today.blocksTotal, 3);
    assert.equal(s.today.complete, true);
    putDoc({ collection: "dayplans", id: day, data: { mode: "full", done: { flashcards: "x" } }, updated_at: 2 });
    s = computeStats(day);
    assert.equal(s.today.blocksTotal, 6);
    assert.equal(s.today.blocksDone, 1);
    assert.equal(s.today.complete, false);
  });

  test("a malformed dayplan doesn't crash", () => {
    const day = addDays(START, 3);
    putDoc({ collection: "dayplans", id: day, data: { mode: "weird" }, updated_at: 1 });
    assert.doesNotThrow(() => computeStats(day));
  });
});

describe("mistakes and cards", () => {
  test("counts by type, tolerating bad rows", () => {
    putDoc({ collection: "mistakes", id: "m1", data: { type: "prepositions", date: START }, updated_at: 1 });
    putDoc({ collection: "mistakes", id: "m2", data: { type: "prepositions", date: START }, updated_at: 1 });
    putDoc({ collection: "mistakes", id: "m3", data: null, updated_at: 1 });
    putDoc({ collection: "srs", id: "c1", data: { state: 2 }, updated_at: 1 });
    putDoc({ collection: "srs", id: "c2", data: { state: 1 }, updated_at: 1 });
    putDoc({ collection: "srs", id: "c3", data: null, updated_at: 1 });
    const s = computeStats(START);
    assert.equal(s.mistakes.total, 3);
    assert.equal(s.mistakes.byType.prepositions, 2);
    assert.equal(s.cardsLearned, 1);
    assert.equal(s.cardsStarted, 3);
  });
});

test("GET /api/stats responds with JSON and CORS for a dashboard", async () => {
  const r = await app.inject({ url: "/api/stats" });
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers["access-control-allow-origin"], "*");
  for (const k of ["streakDays", "totalHours", "speakingMinutes", "cardsLearned", "today"]) assert.ok(k in r.json(), k);
});

import { describe, expect, test } from "vitest";
import { blocksFor, effectiveSettings, minutesByDate, streak, unlockedTopics, weekInfo, weekNumber, DEFAULT_SETTINGS } from "./plan";
import { addDays, daysBetween, fmtMinutes, localDate, prettyDate } from "./time";
import { cur } from "./test/factories";

const S = effectiveSettings({ startDate: "2026-11-23" }, cur);

describe("weekNumber", () => {
  test.each([
    ["2026-11-22", 0],
    ["2026-11-23", 1],
    ["2026-11-29", 1],
    ["2026-11-30", 2],
    ["2027-01-24", 9],
    ["2027-06-01", 9],
  ])("%s → week %i", (d, w) => expect(weekNumber(S, cur, d)).toBe(w));

  test("weekInfo uses week 1 content before the start", () => {
    const w = weekInfo(S, cur, "2026-11-01");
    expect(w.n).toBe(0);
    expect(w.week.week).toBe(1);
    expect(w.level).toBeTruthy();
  });
});

describe("effectiveSettings", () => {
  test("fills blanks from the curriculum and keeps user values", () => {
    const s = effectiveSettings({ startDate: "", newPerDay: 10 }, cur);
    expect(s.startDate).toBe(cur.startDate);
    expect(s.targetDate).toBe(cur.targetDate);
    expect(s.weeklyTargetHours).toBe(14);
    expect(s.newPerDay).toBe(10);
  });
  test("defaults favor speed", () => {
    expect(DEFAULT_SETTINGS.cardDirections).toBe("production");
    expect(DEFAULT_SETTINGS.grading).toBe("two");
    expect(DEFAULT_SETTINGS.autoCards).toBe(true);
    expect(DEFAULT_SETTINGS.celebrations).toBe(false);
  });
  test("works with no settings and no curriculum", () => {
    const s = effectiveSettings(undefined, undefined);
    expect(s.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(daysBetween(s.startDate, s.targetDate)).toBe(63);
  });
});

describe("streak", () => {
  const m = (entries: [string, number][]) => new Map(entries);
  test("empty → 0", () => expect(streak(m([]), "2026-12-01")).toBe(0));
  test("today done counts", () => expect(streak(m([["2026-11-30", 30], ["2026-12-01", 45]]), "2026-12-01")).toBe(2));
  test("today not yet done keeps yesterday's streak", () => expect(streak(m([["2026-11-30", 30], ["2026-12-01", 5]]), "2026-12-01")).toBe(1));
  test("a gap breaks it", () => expect(streak(m([["2026-11-28", 60], ["2026-11-30", 60]]), "2026-12-01")).toBe(1));
  test("two missed days → 0", () => expect(streak(m([["2026-11-28", 60]]), "2026-12-01")).toBe(0));
  test("29 minutes isn't enough", () => expect(streak(m([["2026-12-01", 29]]), "2026-12-01")).toBe(0));
});

test("minutesByDate sums several logs per day", () => {
  const rows = [
    { id: "1", updated_at: 0, data: { date: "2026-12-01", minutes: 10, block: "lesson" as const, ts: 0 } },
    { id: "2", updated_at: 0, data: { date: "2026-12-01", minutes: 25, block: "speaking" as const, ts: 0 } },
    { id: "3", updated_at: 0, data: { date: "2026-12-02", minutes: 5, block: "other" as const, ts: 0 } },
  ];
  const m = minutesByDate(rows);
  expect(m.get("2026-12-01")).toBe(35);
  expect(m.get("2026-12-02")).toBe(5);
});

describe("plans and topics", () => {
  test("full day is 2 hours in every phase; short day is 30 minutes", () => {
    for (const w of cur.weeks) expect(blocksFor("full", w, cur).reduce((a, b) => a + b.minutes, 0)).toBe(120);
    expect(blocksFor("short", cur.weeks[0], cur).reduce((a, b) => a + b.minutes, 0)).toBe(30);
  });
  test("block ids are unique within each plan", () => {
    for (const plan of Object.values(cur.plans)) expect(new Set(plan.map((b) => b.id)).size).toBe(plan.length);
  });
  test("unlockedTopics: current week first, deduped, clamped", () => {
    const t3 = unlockedTopics(cur, 3);
    expect(t3.slice(0, cur.weeks[2].topics.length)).toEqual(cur.weeks[2].topics);
    expect(new Set(t3).size).toBe(t3.length);
    expect(unlockedTopics(cur, 0)).toEqual(cur.weeks[0].topics);
    expect(unlockedTopics(cur, 99)).toEqual(unlockedTopics(cur, 9));
  });
  test("every scenario a week references exists", () => {
    for (const w of cur.weeks) for (const s of w.scenarios) expect(cur.scenarios[s], `${w.week}:${s}`).toBeTruthy();
  });
});

describe("time helpers", () => {
  test("addDays/daysBetween across month, year and leap boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
    expect(daysBetween("2027-03-13", "2027-03-15")).toBe(2);
    expect(daysBetween("2027-01-26", "2026-11-23")).toBe(-64);
  });
  test("localDate uses local fields, not UTC", () => {
    expect(localDate(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31");
    expect(localDate(new Date(2027, 0, 1, 0, 0))).toBe("2027-01-01");
  });
  test("formatting", () => {
    expect(prettyDate("2027-01-26")).toBe("Jan 26");
    expect(fmtMinutes(45)).toBe("45 min");
    expect(fmtMinutes(120)).toBe("2h");
    expect(fmtMinutes(135)).toBe("2h 15m");
  });
});

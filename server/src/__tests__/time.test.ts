import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays, daysBetween, localDate } from "../time.js";

test("addDays crosses month, year and leap-day boundaries", () => {
  assert.equal(addDays("2026-11-30", 1), "2026-12-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addDays("2027-02-28", 1), "2027-03-01");
  assert.equal(addDays("2027-01-01", -1), "2026-12-31");
  assert.equal(addDays("2026-11-23", 0), "2026-11-23");
});

test("daysBetween is signed and DST-proof", () => {
  assert.equal(daysBetween("2026-11-23", "2027-01-26"), 64);
  assert.equal(daysBetween("2027-01-26", "2026-11-23"), -64);
  assert.equal(daysBetween("2027-03-13", "2027-03-15"), 2); // US DST starts 2027-03-14
  assert.equal(daysBetween("2026-11-23", "2026-11-23"), 0);
});

test("localDate uses the given time zone, not UTC", () => {
  // 2026-11-22 03:00 UTC is still Nov 21 in New York, already Nov 22 in Rome.
  const ts = Date.UTC(2026, 10, 22, 3, 0, 0);
  assert.equal(localDate(ts, "America/New_York"), "2026-11-21");
  assert.equal(localDate(ts, "Europe/Rome"), "2026-11-22");
  assert.equal(localDate(ts, "UTC"), "2026-11-22");
});

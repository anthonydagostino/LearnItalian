import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "parla-test-"));
process.env.MOCK_AI = "1";
process.env.APP_PASSWORD = "";

const { importSeed } = await import("./seed.js");
const { buildApp } = await import("./index.js");
const { localDate, addDays } = await import("./time.js");

const seed = importSeed();
const app = await buildApp();

test("seed imports both card directions", () => {
  assert.ok(seed.cards > 1000, `expected >1000 cards, got ${seed.cards}`);
  assert.equal(seed.cards % 2, 0);
});

test("re-importing an unchanged seed changes nothing", () => {
  assert.equal(importSeed().changed, 0);
});

test("sync is last-write-wins and returns changes since a revision", async () => {
  const push = (updated_at: number, minutes: number) =>
    app.inject({
      method: "POST",
      url: "/api/sync",
      payload: { since: 0, changes: [{ collection: "timelogs", id: "t1", data: { date: localDate(), block: "lesson", minutes }, updated_at }] },
    });
  const first = await push(1000, 30);
  assert.equal(first.json().accepted, 1);
  const stale = await push(500, 99);
  assert.equal(stale.json().accepted, 0, "older write must be rejected");
  const rev = first.json().rev;
  const later = await app.inject({ method: "POST", url: "/api/sync", payload: { since: rev, changes: [] } });
  assert.equal(later.json().changes.length, 0);
});

test("server-only collections can't be written by clients", async () => {
  const r = await app.inject({
    method: "POST",
    url: "/api/sync",
    payload: { since: 0, changes: [{ collection: "meta", id: "curriculum", data: {}, updated_at: Date.now() + 1000 }] },
  });
  assert.equal(r.json().accepted, 0);
});

test("stats: streak counts consecutive days with >= 30 min", async () => {
  const today = localDate();
  const changes = [0, 1, 2].map((d) => ({
    collection: "timelogs",
    id: `s${d}`,
    data: { date: addDays(today, -d), block: "speaking", minutes: 30 },
    updated_at: Date.now(),
  }));
  changes.push({ collection: "timelogs", id: "s4", data: { date: addDays(today, -4), block: "speaking", minutes: 60 }, updated_at: Date.now() });
  await app.inject({ method: "POST", url: "/api/sync", payload: { since: 0, changes } });
  const s = (await app.inject({ method: "GET", url: "/api/stats" })).json();
  assert.equal(s.streakDays, 3);
  assert.ok(s.speakingMinutes >= 150);
  assert.equal(typeof s.today.complete, "boolean");
});

test("mock conversation records corrections as mistakes", async () => {
  const start = (
    await app.inject({
      method: "POST",
      url: "/api/chat/start",
      payload: { scenario: "introductions", week: 1, focus: { words: ["il conto", 42, "x".repeat(200)], mistakes: ["ho 35 anni"] } },
    })
  ).json();
  assert.ok(start.id);
  assert.deepEqual(start.conversation.focus.mistakes, ["ho 35 anni"]);
  assert.equal(start.conversation.focus.words.length, 2, "non-strings dropped");
  assert.equal(start.conversation.focus.words[1].length, 80, "long entries truncated");
  const msg = (await app.inject({ method: "POST", url: `/api/chat/${start.id}/message`, payload: { text: "io sono 35 anni" } })).json();
  assert.equal(msg.mistakes.length, 1);
  const end = (await app.inject({ method: "POST", url: `/api/chat/${start.id}/end`, payload: {} })).json();
  assert.ok(end.conversation.summary);
  assert.ok(end.conversation.talkShare > 0 && end.conversation.talkShare <= 100);
});

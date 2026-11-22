import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { freshEnv } from "./helpers.js";

freshEnv({ MOCK_AI: "1" });
const { importSeed } = await import("../seed.js");
const { buildApp } = await import("../index.js");
const { cleanFocus, speakingSeconds } = await import("../chat.js");
const { listDocs } = await import("../db.js");
importSeed();
const app = await buildApp();
after(() => app.close());

const post = async (url: string, payload: unknown = {}) => {
  const r = await app.inject({ method: "POST", url, payload: payload as any });
  return { status: r.statusCode, body: r.json() };
};
const start = (payload: unknown = { scenario: "introductions", week: 1 }) => post("/api/chat/start", payload);

describe("cleanFocus", () => {
  test("keeps strings, drops everything else, trims and caps", () => {
    const f = cleanFocus({ words: ["  il conto ", 3, null, "", "a\nb", "x".repeat(100), ...Array(20).fill("w")], mistakes: "nope" });
    assert.equal(f.words[0], "il conto");
    assert.equal(f.words[1], "a b", "newlines can't inject prompt structure");
    assert.equal(f.words[2].length, 80);
    assert.equal(f.words.length, 12);
    assert.deepEqual(f.mistakes, []);
  });
  test("non-objects become empty focus", () => {
    for (const v of [undefined, null, 5, "s", []]) assert.deepEqual(cleanFocus(v), { words: [], mistakes: [] });
  });
});

describe("speakingSeconds", () => {
  test("sums gaps between turns, capping idle gaps at 3 minutes", () => {
    const t0 = 1_000_000;
    const conv = { startedAt: t0, messages: [{ ts: t0 + 60_000 }, { ts: t0 + 120_000 }, { ts: t0 + 120_000 + 30 * 60_000 }] as any };
    assert.equal(speakingSeconds(conv, t0 + 120_000 + 30 * 60_000 + 10_000), 60 + 60 + 180 + 10);
  });
  test("no messages → time from start to end (capped)", () => {
    assert.equal(speakingSeconds({ startedAt: 0, messages: [] }, 10_000), 10);
    assert.equal(speakingSeconds({ startedAt: 0, messages: [] }, 3_600_000), 180);
  });
});

describe("conversation routes", () => {
  test("start returns the partner's opening line and stores the conversation", async () => {
    const r = await start();
    assert.equal(r.status, 200);
    assert.equal(r.body.conversation.messages.length, 1);
    assert.equal(r.body.conversation.messages[0].role, "assistant");
    assert.ok(listDocs("conversations").some((d) => d.id === r.body.id));
  });

  test("unknown or hostile scenario names fall back to free conversation", async () => {
    for (const scenario of ["nope", "__proto__", "constructor", 5, null]) {
      const r = await start({ scenario, week: 1 });
      assert.equal(r.status, 200, `scenario ${String(scenario)}`);
      assert.equal(r.body.conversation.scenario, "free");
    }
  });

  test("weird week values are clamped instead of crashing", async () => {
    for (const week of ["x", -5, 0, 99, 2.7, null, {}]) {
      const r = await start({ scenario: "restaurant", week });
      assert.equal(r.status, 200, `week ${JSON.stringify(week)}`);
      assert.ok(r.body.conversation.week >= 1 && r.body.conversation.week <= 9);
    }
  });

  test("focus words are cleaned and stored on the conversation", async () => {
    const r = await start({ scenario: "job", week: 4, focus: { words: ["il progetto", 1], mistakes: ["ho 35 anni"] } });
    assert.deepEqual(r.body.conversation.focus, { words: ["il progetto"], mistakes: ["ho 35 anni"] });
  });

  test("message: 404 for unknown conversations", async () => {
    assert.equal((await post("/api/chat/does-not-exist/message", { text: "ciao" })).status, 404);
  });

  test("message: empty, non-string and oversized text → 400", async () => {
    const { body } = await start();
    for (const text of ["", "   ", undefined, null, 5, ["ciao"], { t: 1 }, "a".repeat(2001)]) {
      assert.equal((await post(`/api/chat/${body.id}/message`, { text })).status, 400, `text ${JSON.stringify(text)?.slice(0, 20)}`);
    }
  });

  test("message: correction is returned, stored on the turn and saved as a mistake", async () => {
    const { body } = await start();
    const r = await post(`/api/chat/${body.id}/message`, { text: "Ciao, io sono 35 anni" });
    assert.equal(r.status, 200);
    assert.equal(r.body.user.corrections.length, 1);
    assert.equal(r.body.mistakes.length, 1);
    assert.equal(r.body.mistakes[0].type, "verb_conjugation");
    assert.equal(r.body.mistakes[0].conversationId, body.id);
    assert.ok(listDocs("mistakes").some((m) => m.id === r.body.mistakes[0].id));
  });

  test("help: works with and without a draft, and tolerates bad input", async () => {
    const { body } = await start();
    for (const payload of [{}, { draft: "how do I say hello" }, { draft: 5 }, null]) {
      const r = await post(`/api/chat/${body.id}/help`, payload);
      assert.equal(r.status, 200);
      assert.ok(r.body.say_it);
    }
    assert.equal((await post("/api/chat/nope/help")).status, 404);
  });

  test("end: summary, talk share, speaking time; idempotent; no messages afterwards", async () => {
    const { body } = await start();
    await post(`/api/chat/${body.id}/message`, { text: "io sono 35 anni e lavoro come ingegnere" });
    const e1 = await post(`/api/chat/${body.id}/end`);
    assert.equal(e1.status, 200);
    const c = e1.body.conversation;
    assert.ok(c.endedAt);
    assert.ok(c.summary.top_mistakes.length >= 1);
    assert.ok(c.talkShare > 0 && c.talkShare < 100);
    assert.equal(typeof c.speakingSeconds, "number");
    const e2 = await post(`/api/chat/${body.id}/end`);
    assert.equal(e2.body.conversation.endedAt, c.endedAt, "second end must not change anything");
    assert.equal((await post(`/api/chat/${body.id}/message`, { text: "ancora" })).status, 409);
  });

  test("end with no learner turns gives an empty summary and 0% talk share", async () => {
    const { body } = await start();
    const r = await post(`/api/chat/${body.id}/end`);
    assert.deepEqual(r.body.conversation.summary.top_mistakes, []);
    assert.equal(r.body.conversation.talkShare, 0);
    assert.equal((await post("/api/chat/nope/end")).status, 404);
  });
});

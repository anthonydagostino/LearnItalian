import assert from "node:assert/strict";
import type http from "node:http";
import { after, beforeEach, describe, test } from "node:test";
import { fakeServer, freshEnv, json } from "./helpers.js";

// A fake Anthropic Messages API. Each test queues the responses it wants.
type Reply = { status?: number; body?: unknown; delayMs?: number; headers?: Record<string, string> };
const queue: Reply[] = [];
const requests: { url: string; headers: http.IncomingHttpHeaders; body: any }[] = [];
const fake = await fakeServer((req, body, res) => {
  requests.push({ url: req.url ?? "", headers: req.headers, body: body.length ? JSON.parse(body.toString()) : null });
  const r = queue.shift() ?? { status: 500, body: { type: "error", error: { type: "api_error", message: "no scripted reply" } } };
  setTimeout(() => json(res, r.status ?? 200, r.body, r.headers), r.delayMs ?? 0);
});

freshEnv({ ANTHROPIC_API_KEY: "sk-test", ANTHROPIC_BASE_URL: fake.url, CLAUDE_MAX_RETRIES: "0", CLAUDE_MODEL: "claude-opus-5-5" });
const { importSeed } = await import("../seed.js");
const { buildApp } = await import("../index.js");
importSeed();
const app = await buildApp();
after(async () => {
  await app.close();
  await fake.close();
});
beforeEach(() => {
  queue.length = 0;
  requests.length = 0;
});

const turn = (reply_it: string, corrections: unknown[] = []) => ({ corrections, reply_it, reply_en: `EN: ${reply_it}`, help_en: "" });
const message = (payload: unknown, extra: Record<string, unknown> = {}) => ({
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content: [
    { type: "thinking", thinking: "", signature: "sig-abc" },
    { type: "text", text: JSON.stringify(payload) },
  ],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 10 },
  ...extra,
});
const apiError = (status: number, type: string, msg = "boom") => ({ status, body: { type: "error", error: { type, message: msg } } });

const post = async (url: string, payload: unknown = {}) => {
  const r = await app.inject({ method: "POST", url, payload: payload as any });
  return { status: r.statusCode, body: r.json() };
};
async function startConv() {
  queue.push({ body: message(turn("Buongiorno! Come si chiama?")) });
  const r = await post("/api/chat/start", { scenario: "hotel", week: 2, focus: { words: ["la chiave"], mistakes: ["ho 35 anni"] } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.id as string;
}

describe("request shape", () => {
  test("model, structured output, effort, fallbacks beta and the system prompt", async () => {
    await startConv();
    const req = requests[0];
    assert.match(req.url, /^\/v1\/messages/);
    assert.equal(req.body.model, "claude-opus-5-5");
    assert.equal(req.body.output_config.effort, "low");
    assert.equal(req.body.output_config.format.type, "json_schema");
    assert.equal(req.body.fallbacks, "default");
    assert.match(String(req.headers["anthropic-beta"]), /server-side-fallback-2026-07-01/);
    const auth = String(req.headers["x-api-key"] ?? "") + String(req.headers.authorization ?? "");
    assert.match(auth, /sk-test/, `the configured key is sent (headers: ${Object.keys(req.headers).join(",")})`);
    assert.match(req.body.system, /receptionist/, "scenario role is in the prompt");
    assert.match(req.body.system, /la chiave/, "focus words are in the prompt");
    assert.match(req.body.system, /ho 35 anni/, "recent mistakes are in the prompt");
    assert.equal(req.body.thinking, undefined, "thinking can't be disabled on this model; don't send it");
    assert.equal(req.body.temperature, undefined);
  });

  test("conversation history is replayed append-only, with thinking blocks unchanged", async () => {
    const id = await startConv();
    queue.push({ body: message(turn("Perfetto.", [{ original: "io sono 35 anni", corrected: "ho 35 anni", meaning_en: "I'm 35", explanation_en: "avere for age", type: "verb_conjugation", recurring: true }])) });
    const r = await post(`/api/chat/${id}/message`, { text: "io sono 35 anni" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.user.corrections[0].recurring, true);
    const msgs = requests[1].body.messages;
    assert.equal(msgs.length, 3);
    assert.equal(msgs[0].role, "user");
    assert.equal(msgs[1].role, "assistant");
    assert.deepEqual(msgs[1].content[0], { type: "thinking", thinking: "", signature: "sig-abc" });
    assert.equal(msgs[1].content[1].parsed_output, undefined, "SDK-only fields must be stripped before replay");
    assert.deepEqual(msgs[2], { role: "user", content: "io sono 35 anni" });
    assert.equal(requests[1].body.system, requests[0].body.system, "system prompt is stable across turns (cacheable)");
  });
});

describe("error handling", () => {
  test("refusal → 502 with a clear message, conversation unchanged", async () => {
    const id = await startConv();
    queue.push({ body: message(turn("x"), { stop_reason: "refusal", content: [] }) });
    const r = await post(`/api/chat/${id}/message`, { text: "ciao" });
    assert.equal(r.status, 502);
    assert.match(r.body.error, /declined/);
    // The failed turn must not be persisted.
    queue.push({ body: message(turn("Ciao!")) });
    await post(`/api/chat/${id}/message`, { text: "ciao di nuovo" });
    const replayed = requests.at(-1)!.body.messages.filter((m: any) => m.role === "user").map((m: any) => m.content);
    assert.deepEqual(replayed.slice(1), ["ciao di nuovo"]);
  });

  test("max_tokens cut-off → 502", async () => {
    const id = await startConv();
    queue.push({ body: message(turn("x"), { stop_reason: "max_tokens" }) });
    assert.equal((await post(`/api/chat/${id}/message`, { text: "ciao" })).status, 502);
  });

  test("unparseable model output → 502", async () => {
    const id = await startConv();
    queue.push({ body: message(turn("x"), { content: [{ type: "text", text: "not json" }] }) });
    assert.equal((await post(`/api/chat/${id}/message`, { text: "ciao" })).status, 502);
  });

  const cases: [number, string, number, RegExp][] = [
    [401, "authentication_error", 500, /API key/],
    [404, "not_found_error", 500, /Model not found/],
    [429, "rate_limit_error", 429, /Rate limited/],
    [500, "api_error", 502, /Claude API error/],
    [529, "overloaded_error", 502, /Claude API error/],
    [400, "invalid_request_error", 502, /Claude API error/],
  ];
  for (const [status, type, expect, re] of cases) {
    test(`upstream ${status} ${type} → ${expect}`, async () => {
      queue.push(apiError(status, type));
      const r = await post("/api/chat/start", { scenario: "free" });
      assert.equal(r.status, expect);
      assert.match(r.body.error, re);
    });
  }

  test("a non-JSON upstream body is a clean 5xx, not a crash", async () => {
    queue.push({ status: 200, body: "garbage", delayMs: 0 });
    const r = await post("/api/chat/start", { scenario: "free" });
    assert.ok(r.status >= 500);
  });
});

describe("concurrency", () => {
  test("a second message while one is in flight gets 409 and no turn is lost", async () => {
    const id = await startConv();
    queue.push({ body: message(turn("Prima.")), delayMs: 300 });
    queue.push({ body: message(turn("Seconda.")) });
    const [a, b] = await Promise.all([post(`/api/chat/${id}/message`, { text: "uno" }), post(`/api/chat/${id}/message`, { text: "due" })]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [200, 409]);
    // After the first finishes, a new message works and the history has exactly one learner turn so far.
    queue.push({ body: message(turn("Terza.")) });
    const c = await post(`/api/chat/${id}/message`, { text: "tre" });
    assert.equal(c.status, 200);
    const users = requests.at(-1)!.body.messages.filter((m: any) => m.role === "user");
    assert.equal(users.length, 3, "opening directive + one accepted message + this one");
  });

  test("the lock is released after an error", async () => {
    const id = await startConv();
    queue.push(apiError(500, "api_error"));
    assert.equal((await post(`/api/chat/${id}/message`, { text: "uno" })).status, 502);
    queue.push({ body: message(turn("Ok.")) });
    assert.equal((await post(`/api/chat/${id}/message`, { text: "due" })).status, 200);
  });
});

describe("end", () => {
  test("summary failure still records the end; a retry produces the summary", async () => {
    const id = await startConv();
    queue.push({ body: message(turn("Bene.")) });
    await post(`/api/chat/${id}/message`, { text: "ho una prenotazione" });
    queue.push(apiError(500, "api_error"));
    assert.equal((await post(`/api/chat/${id}/end`)).status, 502);
    assert.equal((await post(`/api/chat/${id}/message`, { text: "x" })).status, 409, "ended conversations take no messages");
    queue.push({ body: message({ top_mistakes: [], went_well: "Good job", focus_next: "Articles" }) });
    const r = await post(`/api/chat/${id}/end`);
    assert.equal(r.status, 200);
    assert.equal(r.body.conversation.summary.went_well, "Good job");
    assert.equal(requests.at(-1)!.body.output_config.effort, "medium", "summaries use the summary effort");
  });
});

describe("help", () => {
  test("sends the recent transcript and the learner's draft; returns the hint", async () => {
    const id = await startConv();
    queue.push({ body: message({ hint_en: "Give your name", say_it: "Ho una prenotazione.", say_it_en: "I have a reservation.", last_reply_en: "Good morning!" }) });
    const r = await post(`/api/chat/${id}/help`, { draft: "I have a booking" });
    assert.equal(r.status, 200);
    assert.equal(r.body.say_it, "Ho una prenotazione.");
    const content = requests.at(-1)!.body.messages[0].content as string;
    assert.match(content, /Partner: Buongiorno! Come si chiama\?/);
    assert.match(content, /I have a booking/);
  });

  test("help is a separate request: it never touches the conversation history", async () => {
    const id = await startConv();
    queue.push({ body: message({ hint_en: "h", say_it: "s", say_it_en: "e", last_reply_en: "" }) });
    await post(`/api/chat/${id}/help`, {});
    assert.match(requests.at(-1)!.body.messages[0].content, /doesn't know what to say/);
    queue.push({ body: message(turn("Va bene.")) });
    await post(`/api/chat/${id}/message`, { text: "ciao" });
    assert.equal(requests.at(-1)!.body.messages.length, 3, "history = opening + reply + this message only");
  });

  test("help errors map like chat errors", async () => {
    const id = await startConv();
    queue.push(apiError(429, "rate_limit_error"));
    assert.equal((await post(`/api/chat/${id}/help`, {})).status, 429);
  });
});

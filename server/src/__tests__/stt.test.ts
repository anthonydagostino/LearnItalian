import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";
import { fakeServer, freshEnv, json, multipart } from "./helpers.js";

let mode: "ok" | "fail" | "badjson" | "notext" = "ok";
const seen: { auth?: string; body: string }[] = [];
const whisper = await fakeServer((req, body, res) => {
  seen.push({ auth: req.headers.authorization, body: body.toString("latin1") });
  if (mode === "fail") return json(res, 500, { error: "model crashed" });
  if (mode === "badjson") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end("{oops");
  }
  if (mode === "notext") return json(res, 200, {});
  json(res, 200, { text: "  Ciao, come stai?  " });
});

freshEnv({ STT_URL: `${whisper.url}/v1/audio/transcriptions`, STT_API_KEY: "whisper-key", STT_MODEL: "test-model" });
const { buildApp } = await import("../index.js");
const app = await buildApp();
after(async () => {
  await app.close();
  await whisper.close();
});
beforeEach(() => {
  mode = "ok";
  seen.length = 0;
});

const audio = (bytes = 5000) => Buffer.alloc(bytes, 7);
const stt = (type: string, data = audio(), name = "speech.m4a") => {
  const m = multipart("audio", name, type, data);
  return app.inject({ method: "POST", url: "/api/stt", payload: m.payload, headers: m.headers });
};

describe("POST /api/stt", () => {
  test("forwards audio as Italian to the Whisper endpoint and trims the text", async () => {
    const r = await stt("audio/mp4");
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().text, "Ciao, come stai?");
    const sent = seen[0];
    assert.equal(sent.auth, "Bearer whisper-key");
    assert.match(sent.body, /name="language"\r\n\r\nit/);
    assert.match(sent.body, /name="model"\r\n\r\ntest-model/);
    assert.match(sent.body, /filename="audio\.m4a"/, "iOS mp4 audio is sent as .m4a");
  });

  test("picks the file extension from the MIME type", async () => {
    for (const [type, ext] of [["audio/webm;codecs=opus", "webm"], ["audio/ogg", "ogg"], ["audio/wav", "wav"], ["audio/aac", "m4a"], ["", "webm"]] as const) {
      seen.length = 0;
      await stt(type || "application/octet-stream");
      assert.match(seen[0].body, new RegExp(`filename="audio\\.${type ? ext : "webm"}"`), type);
    }
  });

  test("tiny recordings (an accidental tap) return empty text without calling Whisper", async () => {
    const r = await stt("audio/mp4", audio(200));
    assert.equal(r.json().text, "");
    assert.equal(seen.length, 0);
  });

  test("upstream failure → 502", async () => {
    mode = "fail";
    assert.equal((await stt("audio/mp4")).statusCode, 502);
  });

  test("upstream returns invalid JSON or no text → handled", async () => {
    mode = "badjson";
    assert.equal((await stt("audio/mp4")).statusCode, 502);
    mode = "notext";
    const r = await stt("audio/mp4");
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().text, "");
  });

  test("not multipart / no file → 4xx, not 500", async () => {
    const r1 = await app.inject({ method: "POST", url: "/api/stt", payload: { a: 1 } });
    assert.ok(r1.statusCode >= 400 && r1.statusCode < 500, String(r1.statusCode));
    const m = multipart("other", "x.txt", "text/plain", Buffer.from("hi"));
    const empty = Buffer.from(m.payload.toString("latin1").replace(/filename="x.txt"/, ""), "latin1");
    const r2 = await app.inject({ method: "POST", url: "/api/stt", payload: empty, headers: m.headers });
    assert.ok(r2.statusCode >= 400 && r2.statusCode < 500, String(r2.statusCode));
  });

  test("files over the size limit are rejected", async () => {
    const r = await stt("audio/mp4", Buffer.alloc(26 * 1024 * 1024));
    assert.equal(r.statusCode, 413);
  });
});

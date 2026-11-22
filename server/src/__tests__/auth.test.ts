import assert from "node:assert/strict";
import { after, test } from "node:test";
import { freshEnv } from "./helpers.js";

freshEnv({ APP_PASSWORD: "s3cret-pass", STATS_TOKEN: "tok123", MOCK_AI: "1" });
const { importSeed } = await import("../seed.js");
const { buildApp } = await import("../index.js");
importSeed();
const app = await buildApp();
after(() => app.close());

const sync = (headers: Record<string, string> = {}, url = "/api/sync") =>
  app.inject({ method: "POST", url, headers, payload: { since: 0, changes: [] } });

async function login(password: unknown) {
  return app.inject({ method: "POST", url: "/api/login", payload: { password } });
}

test("API requires the session cookie", async () => {
  assert.equal((await sync()).statusCode, 401);
});

test("percent-encoded or oddly-slashed API paths can't bypass auth", async () => {
  for (const url of ["/%61pi/sync", "/%2561pi/sync", "//api/sync", "/api//sync", "/API/sync", "/api/sync?x=1", "/./api/sync"]) {
    const r = await sync({}, url);
    assert.notEqual(r.statusCode, 200, `${url} returned 200 without auth`);
  }
});

test("public endpoints stay public", async () => {
  assert.equal((await app.inject({ url: "/api/health" })).statusCode, 200);
  const cfg = await app.inject({ url: "/api/config" });
  assert.equal(cfg.statusCode, 200);
  assert.equal(cfg.json().authed, false);
  assert.equal(cfg.json().passwordRequired, true);
});

test("login: wrong, missing, non-string and prefix passwords are rejected", async () => {
  for (const pw of ["nope", "", undefined, null, 12345, { a: 1 }, ["s3cret-pass"], "s3cret-pas", "s3cret-pass "]) {
    const r = await login(pw);
    assert.equal(r.statusCode, 401, `password ${JSON.stringify(pw)} should fail`);
    assert.equal(r.headers["set-cookie"], undefined);
  }
});

test("login: correct password sets an httpOnly cookie that unlocks the API", async () => {
  const r = await login("s3cret-pass");
  assert.equal(r.statusCode, 200);
  const cookie = String(r.headers["set-cookie"]);
  assert.match(cookie, /parla_session=/);
  assert.match(cookie, /HttpOnly/i);
  const value = cookie.split(";")[0];
  assert.equal((await sync({ cookie: value })).statusCode, 200);
  const cfg = await app.inject({ url: "/api/config", headers: { cookie: value } });
  assert.equal(cfg.json().authed, true);
});

test("a forged cookie is rejected", async () => {
  assert.equal((await sync({ cookie: "parla_session=deadbeef" })).statusCode, 401);
  assert.equal((await sync({ cookie: "parla_session=" })).statusCode, 401);
});

test("stats: bearer token or cookie required when STATS_TOKEN is set", async () => {
  assert.equal((await app.inject({ url: "/api/stats" })).statusCode, 401);
  assert.equal((await app.inject({ url: "/api/stats", headers: { authorization: "Bearer wrong" } })).statusCode, 401);
  assert.equal((await app.inject({ url: "/api/stats", headers: { authorization: "tok123" } })).statusCode, 401);
  const ok = await app.inject({ url: "/api/stats", headers: { authorization: "Bearer tok123" } });
  assert.equal(ok.statusCode, 200);
  assert.equal(typeof ok.json().streakDays, "number");
});

test("login is rate limited after repeated failures", async () => {
  let last = 0;
  for (let i = 0; i < 15; i++) last = (await login("bad-" + i)).statusCode;
  assert.equal(last, 429);
});

test("the login lockout expires after 15 minutes", async () => {
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 16 * 60_000;
    const r = await login("s3cret-pass");
    assert.equal(r.statusCode, 200);
  } finally {
    Date.now = realNow;
  }
});

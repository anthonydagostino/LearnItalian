import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { freshEnv } from "./helpers.js";

freshEnv();
const { buildApp } = await import("../index.js");
const { resolve } = await import("../sync.js");
const app = await buildApp();
after(() => app.close());

type Change = { collection: string; id: string; data?: unknown; updated_at?: unknown; deleted?: boolean; base?: unknown };
async function sync(since: unknown, changes: unknown = []) {
  const r = await app.inject({ method: "POST", url: "/api/sync", payload: { since, changes } });
  return { status: r.statusCode, body: r.json() };
}
const doc = (id: string, updated_at: unknown, data: unknown = { v: id }, extra: Partial<Change> = {}): Change => ({
  collection: "timelogs",
  id,
  data,
  updated_at,
  ...extra,
});

describe("resolve (conflict rule)", () => {
  test("new docs are accepted as-is", () => {
    assert.deepEqual(resolve(undefined, 5, undefined), { accept: true, updatedAt: 5 });
  });
  test("newer timestamp wins", () => {
    assert.deepEqual(resolve({ updated_at: 10 }, 11, undefined), { accept: true, updatedAt: 11 });
  });
  test("older timestamp loses", () => {
    assert.equal(resolve({ updated_at: 10 }, 9, undefined).accept, false);
  });
  test("a tie keeps the server's version", () => {
    assert.equal(resolve({ updated_at: 10 }, 10, undefined).accept, false);
  });
  test("an edit based on the latest version wins even with a slow clock, and stays monotonic", () => {
    assert.deepEqual(resolve({ updated_at: 2000 }, 1500, 2000), { accept: true, updatedAt: 2001 });
  });
  test("an edit based on a stale version falls back to timestamps", () => {
    assert.equal(resolve({ updated_at: 2000 }, 1500, 1000).accept, false);
  });
});

describe("POST /api/sync", () => {
  test("pushes are stored and pulled back with a revision", async () => {
    const r = await sync(0, [doc("a", 1000)]);
    assert.equal(r.status, 200);
    assert.equal(r.body.accepted, 1);
    const got = r.body.changes.find((c: any) => c.id === "a");
    assert.deepEqual(got.data, { v: "a" });
    assert.ok(got.rev > 0);
  });

  test("pulling since the latest rev returns nothing new", async () => {
    const r1 = await sync(0);
    const r2 = await sync(r1.body.rev);
    assert.equal(r2.body.changes.length, 0);
    assert.equal(r2.body.rev, r1.body.rev);
    assert.equal(r2.body.reset, false);
  });

  test("a rejected (older) push returns the server's copy so the client converges", async () => {
    await sync(0, [doc("b", 5000, { v: "server" })]);
    const { body: head } = await sync(0);
    const r = await sync(head.rev, [doc("b", 4000, { v: "stale client" })]);
    assert.equal(r.body.accepted, 0);
    assert.equal(r.body.rejected, 1);
    const b = r.body.changes.find((c: any) => c.id === "b");
    assert.deepEqual(b.data, { v: "server" }, "server copy must be returned even though its rev <= since");
  });

  test("slow-clock device: an edit based on the current version is accepted", async () => {
    await sync(0, [doc("c", 9000, { v: 1 })]);
    const r = await sync(0, [doc("c", 100, { v: 2 }, { base: 9000 })]);
    assert.equal(r.body.accepted, 1);
    const c = r.body.changes.find((x: any) => x.id === "c");
    assert.deepEqual(c.data, { v: 2 });
    assert.ok(c.updated_at > 9000);
  });

  test("timestamps far in the future are clamped", async () => {
    const future = Date.now() + 10 * 365 * 86_400_000;
    const r = await sync(0, [doc("d", future)]);
    const d = r.body.changes.find((x: any) => x.id === "d");
    assert.ok(d.updated_at <= Date.now() + 61_000, "a bad clock must not make a doc unbeatable forever");
  });

  test("deletes propagate as tombstones", async () => {
    await sync(0, [doc("e", 1000)]);
    const r = await sync(0, [doc("e", 2000, {}, { deleted: true })]);
    const e = r.body.changes.find((x: any) => x.id === "e");
    assert.equal(e.deleted, true);
  });

  test("server-only and unknown collections are ignored", async () => {
    const r = await sync(0, [
      { collection: "meta", id: "curriculum", data: { hacked: true }, updated_at: Date.now() },
      { collection: "conversations", id: "x", data: {}, updated_at: Date.now() },
      { collection: "nope", id: "x", data: {}, updated_at: Date.now() },
    ]);
    assert.equal(r.status, 200);
    assert.equal(r.body.accepted, 0);
  });

  test("malformed items are skipped without failing the rest of the batch", async () => {
    const r = await sync(0, [
      null,
      42,
      "str",
      [],
      { collection: "timelogs" },
      { collection: "timelogs", id: "", updated_at: 1 },
      { collection: "timelogs", id: 7, updated_at: 1 },
      { collection: "timelogs", id: "z".repeat(301), updated_at: 1 },
      doc("no-ts", undefined),
      doc("zero-ts", 0),
      doc("neg-ts", -5),
      doc("nan-ts", "abc"),
      doc("good", 1234),
    ]);
    assert.equal(r.status, 200);
    assert.equal(r.body.accepted, 1);
    assert.ok(r.body.changes.some((c: any) => c.id === "good"));
  });

  test("missing data is stored as an empty object", async () => {
    const r = await sync(0, [{ collection: "timelogs", id: "nodata", updated_at: 50 }]);
    assert.deepEqual(r.body.changes.find((c: any) => c.id === "nodata").data, {});
  });

  test("bad 'since' values are rejected with 400", async () => {
    for (const since of ["abc", -1, null, {}, [1, 2]]) {
      const r = await sync(since);
      assert.equal(r.status, since === null ? 200 : 400, `since=${JSON.stringify(since)}`);
    }
  });

  test("non-object bodies don't crash", async () => {
    for (const payload of ["", "null", "[]", "42"]) {
      const r = await app.inject({ method: "POST", url: "/api/sync", headers: { "content-type": "application/json" }, payload });
      assert.ok(r.statusCode < 500, `payload ${payload} → ${r.statusCode}`);
    }
  });

  test("a client ahead of the server (restored backup) gets a full reset", async () => {
    const r = await sync(10_000_000);
    assert.equal(r.body.reset, true);
    assert.ok(r.body.changes.length > 0);
  });

  test("pagination: more than one page is returned in order with more=true", async () => {
    const many = Array.from({ length: 4100 }, (_, i) => doc(`p${i}`, 10 + i));
    await sync(0, many);
    const seen = new Set<string>();
    let since = 0;
    let pages = 0;
    let lastRev = 0;
    for (;;) {
      const r = await sync(since);
      pages++;
      for (const c of r.body.changes) {
        assert.ok(c.rev > lastRev || c.rev <= since, "revisions must increase within the stream");
        lastRev = Math.max(lastRev, c.rev);
        seen.add(c.id);
      }
      since = r.body.rev;
      if (!r.body.more) break;
      assert.ok(pages < 10, "pagination must terminate");
    }
    assert.ok(pages >= 2);
    for (let i = 0; i < 4100; i++) assert.ok(seen.has(`p${i}`));
  });
});

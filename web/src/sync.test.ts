import { beforeEach, describe, expect, test, vi } from "vitest";

// A scriptable fake of the server's /api/sync.
type Req = { since: number; changes: any[] };
const calls: Req[] = [];
let handler: (req: Req) => unknown = () => ({ rev: 0, more: false, changes: [] });
vi.mock("./api", () => ({
  api: vi.fn(async (_path: string, body: Req) => {
    calls.push(structuredClone(body));
    return handler(body);
  }),
}));

const { db, put, get, remove, kvGet, kvSet } = await import("./db");
const { sync, applyServerChanges, resetAndResync } = await import("./sync");

const row = (c: string, id: string) => db.docs.get([c, id]);
const change = (id: string, updated_at: number, data: unknown = { v: id }, rev = 1, deleted = false) => ({
  collection: "timelogs",
  id,
  data,
  updated_at,
  deleted,
  rev,
});

beforeEach(async () => {
  await db.docs.clear();
  await db.kv.clear();
  calls.length = 0;
  handler = () => ({ rev: 0, more: false, changes: [] });
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});

describe("push", () => {
  test("dirty docs are pushed with their base version, then marked clean", async () => {
    await put("timelogs", "a", { minutes: 5 });
    await sync();
    expect(calls[0].changes).toHaveLength(1);
    expect(calls[0].changes[0]).toMatchObject({ collection: "timelogs", id: "a", data: { minutes: 5 }, deleted: false });
    expect((await row("timelogs", "a"))!.dirty).toBe(0);
  });

  test("an edit of a synced doc carries the server version as 'base'", async () => {
    await applyServerChanges([change("b", 5000)]);
    await put("timelogs", "b", { v: "edited" });
    await sync();
    expect(calls[0].changes[0].base).toBe(5000);
  });

  test("a write made while the push is in flight stays dirty (not lost)", async () => {
    await put("timelogs", "c", { v: 1 });
    handler = async () => {
      await put("timelogs", "c", { v: 2 }); // user edits during the request
      return { rev: 1, more: false, changes: [] };
    };
    await sync();
    const r = await row("timelogs", "c");
    expect(r!.data).toEqual({ v: 2 });
    expect(r!.dirty).toBe(1);
  });

  test("two writes in the same millisecond: the second one is not marked clean", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    await put("timelogs", "d", { v: 1 });
    handler = async () => {
      await put("timelogs", "d", { v: 2 });
      return { rev: 1, more: false, changes: [] };
    };
    await sync();
    expect((await row("timelogs", "d"))!.dirty).toBe(1);
  });

  test("deletes are pushed as tombstones", async () => {
    await put("timelogs", "e", { v: 1 });
    await remove("timelogs", "e");
    await sync();
    expect(calls[0].changes[0]).toMatchObject({ id: "e", deleted: true });
    expect(await get("timelogs", "e")).toBeUndefined();
  });

  test("offline: nothing is sent and docs stay dirty", async () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    await put("timelogs", "f", { v: 1 });
    await sync();
    expect(calls).toHaveLength(0);
    expect((await row("timelogs", "f"))!.dirty).toBe(1);
  });

  test("a failed request keeps docs dirty for the next try", async () => {
    await put("timelogs", "g", { v: 1 });
    handler = () => {
      throw new Error("network down");
    };
    await sync();
    expect((await row("timelogs", "g"))!.dirty).toBe(1);
    handler = () => ({ rev: 1, more: false, changes: [] });
    await sync();
    expect((await row("timelogs", "g"))!.dirty).toBe(0);
  });
});

describe("pull", () => {
  test("server changes are applied clean, with base set", async () => {
    handler = () => ({ rev: 7, more: false, changes: [change("h", 100)] });
    await sync();
    const r = await row("timelogs", "h");
    expect(r).toMatchObject({ dirty: 0, updated_at: 100, base: 100 });
    expect(await kvGet("lastRev", 0)).toBe(7);
  });

  test("a newer unsynced local edit is not overwritten by an older server copy", async () => {
    await put("timelogs", "i", { v: "local" });
    const local = await row("timelogs", "i");
    await applyServerChanges([change("i", local!.updated_at - 1000, { v: "server" })]);
    expect((await row("timelogs", "i"))!.data).toEqual({ v: "local" });
  });

  test("a newer server copy replaces a local edit (the server rejected ours)", async () => {
    await put("timelogs", "j", { v: "local" });
    await applyServerChanges([change("j", Date.now() + 60_000, { v: "server" })]);
    expect((await row("timelogs", "j"))!.data).toEqual({ v: "server" });
  });

  test("server tombstones delete local docs", async () => {
    await applyServerChanges([change("k", 100)]);
    await applyServerChanges([change("k", 200, {}, 2, true)]);
    expect(await get("timelogs", "k")).toBeUndefined();
  });

  test("pagination: follows 'more' and advances lastRev", async () => {
    handler = (req) =>
      req.since === 0
        ? { rev: 2, more: true, changes: [change("p1", 1, {}, 1), change("p2", 1, {}, 2)] }
        : { rev: 3, more: false, changes: [change("p3", 1, {}, 3)] };
    await sync();
    expect(calls.map((c) => c.since)).toEqual([0, 2]);
    expect(calls[1].changes, "local changes are pushed only once").toEqual([]);
    expect(await kvGet("lastRev", 0)).toBe(3);
    for (const id of ["p1", "p2", "p3"]) expect(await get("timelogs", id)).toBeTruthy();
  });

  test("a failure mid-pagination keeps the progress made so far", async () => {
    handler = (req) => {
      if (req.since === 0) return { rev: 2, more: true, changes: [change("q1", 1, {}, 2)] };
      throw new Error("boom");
    };
    await sync();
    expect(await kvGet("lastRev", 0)).toBe(2);
    expect(await get("timelogs", "q1")).toBeTruthy();
  });
});

describe("concurrency", () => {
  test("sync() during a running sync triggers exactly one follow-up that includes new writes", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let n = 0;
    handler = async () => {
      n++;
      if (n === 1) await gate;
      return { rev: n, more: false, changes: [] };
    };
    const first = sync();
    await put("timelogs", "late", { v: 1 });
    const second = sync();
    const third = sync();
    expect(second).toBe(third); // coalesced
    release();
    await first;
    await second;
    expect(calls).toHaveLength(2);
    expect(calls[1].changes.map((c) => c.id)).toEqual(["late"]);
  });

  test("resetAndResync waits for a running sync, then pulls from 0", async () => {
    await kvSet("lastRev", 50);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let n = 0;
    handler = async () => {
      if (n++ === 0) await gate;
      return { rev: 99, more: false, changes: [] };
    };
    const running = sync();
    const reset = resetAndResync();
    release();
    await running;
    await reset;
    expect(calls.at(-1)!.since).toBe(0);
  });
});

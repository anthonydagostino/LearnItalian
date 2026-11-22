import { beforeEach, describe, expect, test } from "vitest";
import { all, cacheServerDoc, db, get, patch, put, putMany, remove } from "./db";
import { applyServerChanges } from "./sync";
import { createNote } from "./cards";
import type { CardData } from "./types";

beforeEach(async () => {
  await db.docs.clear();
});

describe("local writes", () => {
  test("put marks dirty, keeps base, bumps the write version", async () => {
    await applyServerChanges([{ collection: "x", id: "1", data: { a: 1 }, updated_at: 500, deleted: false, rev: 1 }]);
    await put("x", "1", { a: 2 });
    const r1 = await db.docs.get(["x", "1"]);
    await put("x", "1", { a: 3 });
    const r2 = await db.docs.get(["x", "1"]);
    expect(r1).toMatchObject({ dirty: 1, base: 500 });
    expect(r2!.base).toBe(500);
    expect(r2!.wv).toBeGreaterThan(r1!.wv!);
  });

  test("patch receives undefined for missing or deleted docs", async () => {
    await patch<{ n: number }>("x", "2", (old) => ({ n: (old?.n ?? 0) + 1 }));
    await patch<{ n: number }>("x", "2", (old) => ({ n: (old?.n ?? 0) + 1 }));
    expect(await get("x", "2")).toEqual({ n: 2 });
    await remove("x", "2");
    await patch<{ n: number }>("x", "2", (old) => ({ n: (old?.n ?? 0) + 10 }));
    expect(await get("x", "2")).toEqual({ n: 10 });
  });

  test("all() and get() hide tombstones", async () => {
    await putMany("x", [
      { id: "a", data: 1 },
      { id: "b", data: 2 },
    ]);
    await remove("x", "a");
    expect((await all("x")).map((r) => r.id)).toEqual(["b"]);
    expect(await get("x", "a")).toBeUndefined();
  });

  test("cacheServerDoc stores a clean copy and never clobbers a local edit", async () => {
    await cacheServerDoc("conversations", "c1", { v: 1 });
    expect(await db.docs.get(["conversations", "c1"])).toMatchObject({ dirty: 0, updated_at: 0 });
    await put("conversations", "c2", { v: "mine" });
    await cacheServerDoc("conversations", "c2", { v: "server" });
    expect(await get("conversations", "c2")).toEqual({ v: "mine" });
  });
});

describe("createNote", () => {
  test("creates both directions of a user card", async () => {
    const id = await createNote({ it: "ho 35 anni", en: "I'm 35", source: "mistake" });
    const cards = await all<CardData>("cards");
    expect(cards).toHaveLength(2);
    expect(id.endsWith(":it2en")).toBe(true);
    expect(cards.map((c) => c.data.dir).sort()).toEqual(["en2it", "it2en"]);
    expect(cards[0].data).toMatchObject({ source: "mistake", topic: "mistakes", kind: "phrase", level: 1 });
  });

  test("doesn't duplicate an existing user card (case/space-insensitive)", async () => {
    const a = await createNote({ it: "Il conto", en: "the check", source: "manual" });
    const b = await createNote({ it: "  il conto ", en: "check", source: "tutor" });
    expect(a).toBe(b);
    expect(await all("cards")).toHaveLength(2);
  });

  test("single words are 'word', phrases are 'phrase'", async () => {
    await createNote({ it: "scadenza", en: "deadline", source: "tutor" });
    const c = (await all<CardData>("cards"))[0];
    expect(c.data.kind).toBe("word");
    expect(c.data.topic).toBe("tutor");
  });
});

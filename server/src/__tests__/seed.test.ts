import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { freshEnv } from "./helpers.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const realSeed = path.resolve(here, "..", "..", "..", "seed");
const seedDir = fs.mkdtempSync(path.join(os.tmpdir(), "parla-seed-"));
fs.mkdirSync(path.join(seedDir, "deck"));
fs.copyFileSync(path.join(realSeed, "curriculum.json"), path.join(seedDir, "curriculum.json"));
freshEnv({ SEED_DIR: seedDir });

const { importSeed, slug, sameMeaning, validateCurriculum } = await import("../seed.js");
const { getDoc, getRow, listDocs, putDoc } = await import("../db.js");

const write = (name: string, content: unknown) =>
  fs.writeFileSync(path.join(seedDir, "deck", name), typeof content === "string" ? content : JSON.stringify(content));
const remove = (name: string) => fs.rmSync(path.join(seedDir, "deck", name), { force: true });
const item = (it: string, en: string, extra: Record<string, unknown> = {}) => ({ it, en, ex: `${it}!`, ex_en: `${en}!`, kind: "word", level: 1, ...extra });
const seedCards = () => listDocs("cards").filter((d) => d.data.source === "seed");

describe("slug / sameMeaning", () => {
  test("slug strips accents, punctuation and case", () => {
    assert.equal(slug("Perché?"), "perche");
    assert.equal(slug("l'acqua"), "l-acqua");
    assert.equal(slug("  Così così.  "), "cosi-cosi");
    assert.equal(slug("…"), "");
    assert.ok(slug("a".repeat(200)).length <= 60);
  });
  test("sameMeaning spots duplicates but keeps homographs apart", () => {
    assert.ok(sameMeaning("the café (bar)", "the café, coffee bar"));
    assert.ok(sameMeaning("expensive; dear", "expensive"));
    assert.ok(sameMeaning("I would like…", "I'd like…"));
    assert.ok(!sameMeaning("to stay", "to stand"));
    assert.ok(!sameMeaning("nice to meet you; pleasure", "to like (lit. to be pleasing)"));
    assert.ok(sameMeaning("And you? (formal)", "and you?"), "stopword-only glosses compare whole");
    assert.ok(!sameMeaning("And you?", "And me?"));
  });
});

describe("validateCurriculum", () => {
  const good = JSON.parse(fs.readFileSync(path.join(realSeed, "curriculum.json"), "utf8"));
  test("accepts the real curriculum", () => assert.doesNotThrow(() => validateCurriculum(good)));
  test("rejects broken shapes", () => {
    for (const bad of [null, {}, { ...good, weeks: [] }, { ...good, startDate: "soon" }, { ...good, plans: { ...good.plans, short: undefined } }, { ...good, weeks: [{ ...good.weeks[0], phase: "nope" }] }]) {
      assert.throws(() => validateCurriculum(bad));
    }
  });
});

describe("importSeed", () => {
  test("imports both directions per item", () => {
    write("a.json", { topic: "alpha", title: "Alpha", items: [item("ciao", "hi"), item("grazie", "thanks")] });
    const r = importSeed();
    assert.equal(r.cards, 4);
    assert.ok(getDoc("cards", "alpha:ciao:it2en"));
    assert.ok(getDoc("cards", "alpha:ciao:en2it"));
    assert.ok(getDoc("meta", "curriculum"));
  });

  test("re-importing unchanged files changes nothing", () => {
    assert.equal(importSeed().changed, 0);
  });

  test("editing an item updates only that card and keeps the user's suspension", () => {
    const c = getDoc("cards", "alpha:ciao:it2en")!;
    putDoc({ collection: "cards", id: "alpha:ciao:it2en", data: { ...c.data, suspended: true }, updated_at: Date.now() });
    write("a.json", { topic: "alpha", title: "Alpha", items: [item("ciao", "hi; bye"), item("grazie", "thanks")] });
    const r = importSeed();
    assert.equal(r.changed, 2);
    const after = getDoc("cards", "alpha:ciao:it2en")!;
    assert.equal(after.data.en, "hi; bye");
    assert.equal(after.data.suspended, true, "suspension must survive a re-import");
  });

  test("an item removed from the file is soft-deleted; re-adding restores it", () => {
    write("a.json", { topic: "alpha", title: "Alpha", items: [item("ciao", "hi; bye")] });
    importSeed();
    assert.equal(getDoc("cards", "alpha:grazie:it2en"), null);
    assert.equal(getRow("cards", "alpha:grazie:it2en")!.deleted, 1);
    write("a.json", { topic: "alpha", title: "Alpha", items: [item("ciao", "hi; bye"), item("grazie", "thanks")] });
    importSeed();
    assert.ok(getDoc("cards", "alpha:grazie:it2en"));
  });

  test("invalid JSON leaves that file's cards untouched and doesn't crash", () => {
    write("a.json", "{ not json");
    const r = importSeed();
    assert.ok(r.warnings.some((w) => w.includes("invalid JSON")));
    assert.ok(getDoc("cards", "alpha:ciao:it2en"), "cards from a broken file must not be deleted");
  });

  test("valid JSON with the wrong shape is a warning, not a crash", () => {
    for (const bad of [null, [], { topic: "alpha" }, { topic: "alpha", items: "nope" }]) {
      write("a.json", bad);
      const r = importSeed();
      assert.ok(r.warnings.length > 0);
      assert.ok(getDoc("cards", "alpha:ciao:it2en"));
    }
  });

  test("bad items are skipped with a warning; good ones still import", () => {
    write("a.json", {
      topic: "alpha",
      items: [null, 5, { it: "x" }, { en: "y" }, { it: "", en: "z" }, { it: 3, en: "n" }, { it: "…", en: "dots" }, item("ciao", "hi; bye"), item("grazie", "thanks")],
    });
    const r = importSeed();
    assert.ok(r.warnings.filter((w) => w.startsWith("a.json#")).length >= 6);
    assert.ok(getDoc("cards", "alpha:ciao:it2en"));
  });

  test("invalid fields fall back to safe defaults", () => {
    write("b.json", { topic: "beta", items: [{ it: "casa", en: "house", level: 9, kind: "weird", ex: 5 }] });
    importSeed();
    const c = getDoc("cards", "beta:casa:it2en")!;
    assert.equal(c.data.level, 2);
    assert.equal(c.data.kind, "word");
    assert.equal(c.data.ex, "");
  });

  test("cross-file duplicates with the same meaning are skipped; homographs are kept", () => {
    write("c.json", {
      topic: "gamma",
      items: [item("casa", "the house"), item("piacere", "nice to meet you")],
    });
    write("d.json", { topic: "delta", items: [item("piacere", "to please")] });
    const r = importSeed();
    assert.ok(r.warnings.some((w) => w.includes('duplicate "casa"')));
    assert.ok(getDoc("cards", "gamma:piacere:it2en"));
    assert.ok(getDoc("cards", "delta:piacere:it2en"));
  });

  test("homographs inside one file get stable, order-independent ids", () => {
    write("e.json", { topic: "eps", items: [item("perché (why)", "why"), item("la", "the (f.)"), item("la", "her (pronoun)")] });
    importSeed();
    const idsA = seedCards().filter((c) => c.data.topic === "eps" && c.data.it === "la").map((c) => `${c.id}|${c.data.en}`).sort();
    write("e.json", { topic: "eps", items: [item("la", "her (pronoun)"), item("la", "the (f.)"), item("perché (why)", "why")] });
    importSeed();
    const idsB = seedCards().filter((c) => c.data.topic === "eps" && c.data.it === "la").map((c) => `${c.id}|${c.data.en}`).sort();
    assert.equal(idsA.length, 4);
    assert.deepEqual(idsA, idsB, "reordering must not move progress between homographs");
  });

  test("a missing deck directory never deletes cards", () => {
    const before = seedCards().length;
    fs.renameSync(path.join(seedDir, "deck"), path.join(seedDir, "deck-off"));
    const r = importSeed();
    fs.renameSync(path.join(seedDir, "deck-off"), path.join(seedDir, "deck"));
    assert.ok(r.warnings.some((w) => w.includes("no deck files")));
    assert.equal(seedCards().length, before);
  });

  test("a broken curriculum.json keeps the previous version", () => {
    const file = path.join(seedDir, "curriculum.json");
    const good = fs.readFileSync(file, "utf8");
    fs.writeFileSync(file, '{"weeks": []}');
    const r = importSeed();
    fs.writeFileSync(file, good);
    assert.ok(r.warnings.some((w) => w.includes("curriculum.json is invalid")));
    assert.ok(getDoc("meta", "curriculum")!.data.weeks.length > 0);
  });

  test("the real seed deck imports cleanly", () => {
    remove("a.json");
    for (const f of ["b.json", "c.json", "d.json", "e.json"]) remove(f);
    for (const f of fs.readdirSync(path.join(realSeed, "deck"))) fs.copyFileSync(path.join(realSeed, "deck", f), path.join(seedDir, "deck", f));
    const r = importSeed();
    assert.ok(r.cards > 2400, `cards: ${r.cards}`);
    assert.equal(r.warnings.filter((w) => !w.startsWith("duplicate")).length, 0, r.warnings.join("\n"));
    for (const c of seedCards()) {
      assert.ok(c.data.it && c.data.en, `${c.id} missing text`);
      assert.ok(c.data.ex, `${c.id} missing example sentence`);
    }
  });
});

test("the exact same item twice in one file is imported once", () => {
  write("z.json", { topic: "zeta", items: [item("zzparola", "zzword"), item("zzparola", "zzword")] });
  const r = importSeed();
  assert.ok(r.warnings.some((w) => w.includes("duplicates another item in the same file")));
  remove("z.json");
});

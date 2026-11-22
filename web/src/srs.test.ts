import { describe, expect, test } from "vitest";
import { buildQueue, checkAnswer, humanInterval, newSrs, normalize, previewIntervals, rate, Rating, wordMatches } from "./srs";
import { card, cur, note, srsState } from "./test/factories";

describe("normalize", () => {
  test.each([
    ["Perché?", "perche"],
    ["  Così   così!! ", "cosi cosi"],
    ["l’acqua", "l' acqua"],
    ["L'ACQUA", "l' acqua"],
    ["perché (why)", "perche"],
    ["E… allora?", "e allora"],
    ["", ""],
  ])("%j → %j", (a, b) => expect(normalize(a)).toBe(b));
});

describe("checkAnswer", () => {
  const ok = (heard: string, expected: string) => expect(checkAnswer(heard, expected).verdict).toBe("correct");
  const close = (heard: string, expected: string) => expect(checkAnswer(heard, expected).verdict).toBe("close");
  const wrong = (heard: string, expected: string) => expect(checkAnswer(heard, expected).verdict).toBe("wrong");

  test("exact matches ignore case, accents, punctuation and hints", () => {
    ok("perche", "Perché?");
    ok("Buongiorno!", "buongiorno");
    ok("si", "sì");
    ok("dove il bagno", "Dov'è il bagno?".replace("Dov'è", "dove"));
    ok("perche", "perché (why)");
  });

  test("any alternative separated by / or ; counts", () => {
    ok("ora", "adesso / ora");
    ok("adesso", "adesso / ora");
    ok("qua", "qui; qua");
  });

  test("short alternatives don't match inside longer words (regression: 'la' vs 'lavoro')", () => {
    wrong("lavoro", "il / lo / la");
    wrong("suo", "su");
    wrong("treno", "tre");
    wrong("seicento", "sei");
  });

  test("hesitation fillers around the answer are fine", () => {
    ok("ehm il conto", "il conto");
    ok("allora grazie", "grazie");
  });

  test("extra meaningful words make it only 'close' (regression: 'non è bello' ≠ 'è bello')", () => {
    close("non e bello", "è bello");
    close("il conto per favore", "il conto");
  });

  test("article-only differences are 'close', not correct", () => {
    const r = checkAnswer("conto", "il conto");
    expect(r.verdict).toBe("close");
    expect(r.articleOnly).toBe(true);
  });

  test("small transcription slips are close; unrelated answers are wrong", () => {
    close("buongiorna", "buongiorno");
    wrong("arrivederci", "buongiorno");
  });

  test("empty input is wrong, never correct", () => {
    wrong("", "ciao");
    wrong("   ", "ciao");
    wrong("ciao", "");
  });
});

describe("wordMatches", () => {
  test("flags words that weren't heard, keeping original spelling", () => {
    expect(wordMatches("vorrei un caffe", "Vorrei un caffè, per favore.")).toEqual([
      { word: "Vorrei", ok: true },
      { word: "un", ok: true },
      { word: "caffè,", ok: true },
      { word: "per", ok: false },
      { word: "favore.", ok: false },
    ]);
  });
  test("an empty transcript marks everything missing", () => {
    expect(wordMatches("", "Ciao Marco").every((w) => !w.ok)).toBe(true);
  });
});

describe("scheduling", () => {
  const now = new Date("2026-11-20T10:00:00Z");
  test("a new card rated Again comes back within minutes; Good on a review pushes it out", () => {
    const s = newSrs("2026-11-20", now);
    const again = rate(s, Rating.Again, now);
    expect(again.due - now.getTime()).toBeLessThan(15 * 60_000);
    expect(again.introducedOn).toBe("2026-11-20");
    let r = rate(s, Rating.Good, now);
    for (let i = 0; i < 3; i++) r = rate(r, Rating.Good, new Date(r.due));
    expect(r.state).toBe(2);
    expect(r.due - now.getTime()).toBeGreaterThan(86_400_000);
  });
  test("previewIntervals gives a label per grade, Again ≤ Good ≤ Easy", () => {
    const p = previewIntervals(newSrs("2026-11-20", now), now);
    expect(Object.keys(p)).toHaveLength(4);
  });
  test.each([
    [30_000, "1m"],
    [45 * 60_000, "45m"],
    [5 * 3_600_000, "5h"],
    [3 * 86_400_000, "3d"],
    [45 * 86_400_000, "1.5mo"],
    [400 * 86_400_000, "1.1y"],
  ])("humanInterval(%i) = %s", (ms, label) => expect(humanInterval(ms)).toBe(label));
});

describe("buildQueue", () => {
  const today = "2026-11-25";
  const now = new Date("2026-11-25T12:00:00Z").getTime();
  const base = { today, now, cur, week: 1, newPerDay: 25, reviewCap: 200, reviewsToday: 0 };

  test("production mode introduces only English→Italian cards", () => {
    const cards = [...note("ciao", "hi"), ...note("grazie", "thanks")];
    const q = buildQueue({ ...base, cards, srs: new Map(), directions: "production" });
    expect(q.fresh.map((c) => c.data.dir)).toEqual(["en2it", "en2it"]);
  });

  test("both mode: a seed en2it card waits for its it2en sibling from an earlier day", () => {
    const cards = note("ciao", "hi");
    const none = buildQueue({ ...base, cards, srs: new Map(), directions: "both" });
    expect(none.fresh.map((c) => c.data.dir)).toEqual(["it2en"]);
    const sameDay = buildQueue({ ...base, cards, srs: new Map([[cards[0].id, srsState({ due: now + 1e9 }, today)]]), directions: "both" });
    expect(sameDay.fresh).toHaveLength(0);
    const earlier = buildQueue({ ...base, cards, srs: new Map([[cards[0].id, srsState({ due: now + 1e9 }, "2026-11-20")]]), directions: "both" });
    expect(earlier.fresh.map((c) => c.data.dir)).toEqual(["en2it"]);
  });

  test("both mode: a suspended it2en sibling doesn't block its en2it card forever", () => {
    const [it, en] = note("ciao", "hi");
    it.data.suspended = true;
    const q = buildQueue({ ...base, cards: [it, en], srs: new Map(), directions: "both" });
    expect(q.fresh.map((c) => c.id)).toEqual([en.id]);
  });

  test("new-card limit counts cards already introduced today", () => {
    const cards = Array.from({ length: 10 }, (_, i) => card(`w${i}`, `x${i}`, { dir: "en2it" }));
    const srs = new Map([[cards[0].id, srsState({ due: now + 1e9 }, today)], [cards[1].id, srsState({ due: now + 1e9 }, today)]]);
    const q = buildQueue({ ...base, cards, srs, newPerDay: 3 });
    expect(q.newToday).toBe(2);
    expect(q.fresh).toHaveLength(1);
    expect(buildQueue({ ...base, cards, srs, newPerDay: 1 }).fresh).toHaveLength(0);
  });

  test("review cap accounts for reviews already done; never negative", () => {
    const cards = Array.from({ length: 5 }, (_, i) => card(`r${i}`, `r${i}`, { dir: "en2it" }));
    const srs = new Map(cards.map((c) => [c.id, srsState({ due: now - 1000, state: 2, stability: 5 }, "2026-11-01")]));
    expect(buildQueue({ ...base, cards, srs, reviewCap: 10, reviewsToday: 7 }).due).toHaveLength(3);
    expect(buildQueue({ ...base, cards, srs, reviewCap: 10, reviewsToday: 50 }).due).toHaveLength(0);
  });

  test("due cards come most-forgotten first; future cards aren't due", () => {
    const [a, b, c] = ["a", "b", "c"].map((w) => card(w, w, { dir: "en2it" }));
    const srs = new Map([
      [a.id, srsState({ state: 2, stability: 30, due: now - 1, last_review: now - 2 * 86_400_000 }, "2026-11-01")],
      [b.id, srsState({ state: 2, stability: 1, due: now - 1, last_review: now - 10 * 86_400_000 }, "2026-11-01")],
      [c.id, srsState({ state: 2, stability: 5, due: now + 86_400_000, last_review: now }, "2026-11-01")],
    ]);
    const q = buildQueue({ ...base, cards: [a, b, c], srs });
    expect(q.due.map((x) => x.id)).toEqual([b.id, a.id]);
  });

  test("user cards (from mistakes/tutor) are introduced before seed cards; suspended never", () => {
    const seed = card("casa", "house", { dir: "en2it" });
    const mine = card("ho 35 anni", "I'm 35", { dir: "en2it", source: "mistake", noteId: "user:1" });
    const sus = card("no", "no", { dir: "en2it", suspended: true, source: "mistake", noteId: "user:2" });
    const q = buildQueue({ ...base, cards: [seed, mine, sus], srs: new Map() });
    expect(q.fresh.map((c) => c.id)).toEqual([mine.id, seed.id]);
  });

  test("this week's topics and level come before later material", () => {
    const later = card("il binario", "platform", { dir: "en2it", topic: "travel_transport", level: 2 });
    const now1 = card("ciao", "hi", { dir: "en2it", topic: "greetings", level: 1 });
    const q = buildQueue({ ...base, cards: [later, now1], srs: new Map(), week: 1 });
    expect(q.fresh[0].id).toBe(now1.id);
  });

  test("week 0 (before the start) and weeks past the end don't crash", () => {
    const cards = note("ciao", "hi");
    expect(() => buildQueue({ ...base, cards, srs: new Map(), week: 0 })).not.toThrow();
    expect(() => buildQueue({ ...base, cards, srs: new Map(), week: 99 })).not.toThrow();
  });

  test("learned counts review-state cards", () => {
    const cards = note("ciao", "hi");
    const srs = new Map([[cards[1].id, srsState({ state: 2, due: now + 1e9 }, "2026-11-01")]]);
    expect(buildQueue({ ...base, cards, srs }).learned).toBe(1);
  });
});

import { describe, expect, test } from "vitest";
import { buildDrill, sameSentence, tokenize, type Exercise } from "./drill";
import { normalize } from "./srs";
import { card, note, srsState } from "./test/factories";
import type { CardData } from "./types";
import type { Row } from "./db";

describe("tokenize / sameSentence", () => {
  test("strips punctuation and quotes, keeps apostrophes and accents", () => {
    expect(tokenize("«Ciao!» Com'è andata… bene?")).toEqual(["Ciao", "Com'è", "andata", "bene"]);
    expect(tokenize("  ")).toEqual([]);
    expect(tokenize("Sì, grazie.")).toEqual(["Sì", "grazie"]);
  });
  test("sameSentence ignores case, accents and punctuation but not word order", () => {
    expect(sameSentence("vorrei un caffe", "Vorrei un caffè.")).toBe(true);
    expect(sameSentence("un caffè vorrei", "Vorrei un caffè.")).toBe(false);
  });
});

function deck(n: number): Row<CardData>[] {
  const words = ["casa", "cane", "gatto", "libro", "treno", "mare", "sole", "pane", "vino", "acqua", "strada", "porta", "tavolo", "sedia", "finestra"];
  return words.slice(0, n).flatMap((w, i) =>
    note(w, `thing ${i}`, { ex: `Questa è la mia ${w} nuova.`, exEn: `This is my new thing ${i}.`, topic: i % 2 ? "greetings" : "food_drink" }),
  );
}
const opts = (cards: Row<CardData>[], extra: Partial<Parameters<typeof buildDrill>[0]> = {}) => ({
  cards,
  srs: new Map(),
  recentAgain: new Set<string>(),
  topics: ["greetings", "food_drink"],
  maxLevel: 1,
  canSpeak: true,
  ...extra,
});

const answerOf = (e: Exercise) => (e.type === "meaning" || e.type === "listen" ? e.answer : "");

describe("buildDrill", () => {
  test("an empty deck gives no exercises (and doesn't loop)", () => {
    expect(buildDrill(opts([]))).toEqual([]);
  });

  test("a normal deck gives a production-heavy round", () => {
    const ex = buildDrill(opts(deck(15)));
    expect(ex.length).toBeGreaterThanOrEqual(8);
    const types = ex.map((e) => e.type);
    expect(types.filter((t) => t === "build" || t === "speak").length).toBeGreaterThan(types.length / 2);
  });

  test("no speaking exercises when the device can't do speech recognition", () => {
    expect(buildDrill(opts(deck(15), { canSpeak: false })).some((e) => e.type === "speak")).toBe(false);
  });

  test("choice options: answer included exactly once, no duplicates even ignoring accents", () => {
    for (let run = 0; run < 20; run++) {
      for (const e of buildDrill(opts(deck(15)))) {
        if (e.type !== "meaning" && e.type !== "listen") continue;
        const keys = e.options.map(normalize);
        expect(new Set(keys).size).toBe(keys.length);
        expect(e.options.filter((o) => o === answerOf(e))).toHaveLength(1);
      }
    }
  });

  test("tiny decks still produce valid (if shorter) choice exercises", () => {
    for (const e of buildDrill(opts(deck(2)))) {
      if (e.type === "meaning" || e.type === "listen") expect(e.options).toContain(e.answer);
    }
  });

  test("word-bank tiles contain every word of the answer, distractors aren't accent-twins", () => {
    for (let run = 0; run < 20; run++) {
      for (const e of buildDrill(opts(deck(15)))) {
        if (e.type !== "build") continue;
        const words = tokenize(e.it);
        for (const w of words) expect(e.tiles).toContain(w);
        const extras = e.tiles.slice().filter((t) => !words.includes(t));
        for (const x of extras) expect(words.map(normalize)).not.toContain(normalize(x));
        expect(sameSentence(words.join(" "), e.it)).toBe(true);
      }
    }
  });

  test("sentences with dialogue dashes or too many words are never used for word-bank", () => {
    const cards = [card("ciao", "hi", { ex: "Ciao! — Ciao, Marco!" }), card("lungo", "long", { ex: "uno due tre quattro cinque sei sette otto nove dieci" })];
    expect(buildDrill(opts(cards)).some((e) => e.type === "build")).toBe(false);
  });

  test("each exercise uses a different card", () => {
    const ex = buildDrill(opts(deck(15)));
    const ids = ex.filter((e) => "cardId" in e).map((e) => (e as { cardId: string }).cardId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("weak cards (many lapses, recently forgotten) are prioritized", () => {
    const cards = deck(15);
    const weak = cards.find((c) => c.data.it === "finestra" && c.data.dir === "en2it")!;
    const srs = new Map([[weak.id, srsState({ lapses: 5, stability: 0.2 })]]);
    let hits = 0;
    for (let run = 0; run < 10; run++) {
      const ex = buildDrill(opts(cards, { srs, recentAgain: new Set([weak.id]) }));
      if (ex.some((e) => ("it" in e ? e.it : "").includes("finestra"))) hits++;
    }
    expect(hits).toBeGreaterThanOrEqual(8);
  });
});

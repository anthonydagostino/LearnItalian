import type { Row } from "./db";
import type { CardData, SrsData } from "./types";
import { normalize } from "./srs";

export type Exercise =
  | { type: "match"; pairs: { it: string; en: string }[] }
  | { type: "meaning"; it: string; options: string[]; answer: string; cardId: string }
  | { type: "listen"; it: string; options: string[]; answer: string; cardId: string }
  | { type: "build"; en: string; it: string; tiles: string[]; cardId: string }
  | { type: "speak"; it: string; en: string; cardId: string };

const shuffle = <T,>(a: T[]) => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
};
const strip = (s: string) => s.replace(/\s*\(.*?\)\s*/g, " ").trim();

/** Split an Italian sentence into tiles, dropping punctuation but keeping apostrophes and accents. */
export function tokenize(s: string): string[] {
  return s
    .replace(/[«»"“”…]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[¿¡.,;:!?]+|[.,;:!?]+$/g, ""))
    .filter(Boolean);
}

export function sameSentence(a: string, b: string) {
  return normalize(a) === normalize(b);
}

/**
 * Build a ~12-exercise drill aimed at your weak spots: cards you keep forgetting (lapses, recent "Forgot"),
 * cards made from your mistakes, and the least stable cards. Mostly production (build / speak).
 */
export function buildDrill(opts: {
  cards: Row<CardData>[];
  srs: Map<string, SrsData>;
  recentAgain: Set<string>; // card ids rated "Forgot" in the last 7 days
  topics: string[];
  maxLevel: number;
  canSpeak: boolean;
}): Exercise[] {
  const notes = opts.cards.filter((c) => c.data.dir === "it2en" && !c.data.suspended);
  const byNote = new Map(notes.map((c) => [c.data.noteId, c]));
  // Weakness score per note, from any of its cards' scheduling state.
  const score = new Map<string, number>();
  for (const c of opts.cards) {
    const s = opts.srs.get(c.id);
    const fromMistake = c.data.source === "mistake" || c.data.source === "tutor";
    if (!s && !fromMistake) continue;
    let w = 0;
    if (s) w += s.lapses * 2 + 1 / (s.stability + 0.5);
    if (opts.recentAgain.has(c.id)) w += 3;
    if (fromMistake) w += 2;
    score.set(c.data.noteId, Math.max(score.get(c.data.noteId) ?? 0, w));
  }
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => byNote.get(n)).filter((x): x is Row<CardData> => !!x);
  let pool = shuffle(ranked.slice(0, 24));
  if (pool.length < 12) {
    const week = notes.filter((c) => opts.topics.slice(0, 4).includes(c.data.topic) && c.data.level <= opts.maxLevel && !score.has(c.data.noteId));
    pool = [...pool, ...shuffle(week).slice(0, 16 - pool.length)];
  }
  if (pool.length < 6) pool = [...pool, ...shuffle(notes).slice(0, 12)];
  const enOf = (c: Row<CardData>) => strip(c.data.en.split(/[;(]/)[0]);
  const distract = (c: Row<CardData>, field: "en" | "it", n = 3) => {
    const sameTopic = shuffle(notes.filter((x) => x.id !== c.id && x.data.topic === c.data.topic));
    const any = shuffle(notes.filter((x) => x.id !== c.id));
    const out: string[] = [];
    const correct = field === "en" ? enOf(c) : strip(c.data.it);
    for (const x of [...sameTopic, ...any]) {
      const v = field === "en" ? enOf(x) : strip(x.data.it);
      if (v && v.toLowerCase() !== correct.toLowerCase() && !out.includes(v)) out.push(v);
      if (out.length >= n) break;
    }
    return out;
  };

  const ex: Exercise[] = [];
  const used = new Set<string>();
  const take = (pred: (c: Row<CardData>) => boolean) => {
    const c = pool.find((x) => !used.has(x.id) && pred(x));
    if (c) used.add(c.id);
    return c;
  };
  const sentenceOk = (c: Row<CardData>) => {
    if (!c.data.ex || c.data.ex.includes(" — ")) return false;
    const n = tokenize(c.data.ex).length;
    return n >= 3 && n <= 9;
  };

  // Production-heavy mix: building and saying sentences are what transfer to speaking.
  const plan: Exercise["type"][] = ["build", "speak", "listen", "build", "speak", "meaning", "build", "speak", "listen", "build", "speak", "build"];
  for (const t of plan) {
    if (t === "speak" && !opts.canSpeak) continue;
    if (t === "meaning" || t === "listen") {
      const c = take((x) => strip(x.data.it).length <= 40);
      if (!c) continue;
      if (t === "meaning") {
        const answer = enOf(c);
        ex.push({ type: "meaning", it: strip(c.data.it), answer, options: shuffle([answer, ...distract(c, "en")]), cardId: c.id });
      } else {
        const answer = strip(c.data.it);
        ex.push({ type: "listen", it: answer, answer, options: shuffle([answer, ...distract(c, "it")]), cardId: c.id });
      }
    } else if (t === "build") {
      const c = take(sentenceOk);
      if (!c) continue;
      const words = tokenize(c.data.ex);
      const lower = new Set(words.map((w) => w.toLowerCase()));
      const extra: string[] = [];
      for (const x of shuffle(pool)) {
        for (const w of tokenize(x.data.ex || "")) {
          const lw = w.toLowerCase();
          if (!lower.has(lw) && !extra.includes(lw) && w.length > 1) extra.push(lw);
          if (extra.length >= 3) break;
        }
        if (extra.length >= 3) break;
      }
      ex.push({ type: "build", en: c.data.exEn, it: c.data.ex, tiles: shuffle([...words, ...extra]), cardId: c.id });
    } else if (t === "speak") {
      const c = take((x) => !!x.data.ex && !x.data.ex.includes(" — ") && x.data.ex.length <= 60) ?? take(() => true);
      if (!c) continue;
      const it = c.data.ex && c.data.ex.length <= 60 && !c.data.ex.includes(" — ") ? c.data.ex : strip(c.data.it);
      ex.push({ type: "speak", it, en: it === c.data.ex ? c.data.exEn : c.data.en, cardId: c.id });
    }
  }
  return ex;
}

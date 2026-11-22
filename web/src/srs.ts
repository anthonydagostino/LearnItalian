import { createEmptyCard, fsrs, generatorParameters, Rating, type Card, type Grade } from "ts-fsrs";
import type { CardData, SrsData } from "./types";
import type { Row } from "./db";
import type { Curriculum } from "./plan";
import { unlockedTopics } from "./plan";

export const scheduler = fsrs(generatorParameters({ enable_fuzz: true, request_retention: 0.9, maximum_interval: 365 }));
export { Rating };
export type { Grade };

export function toCard(s: SrsData): Card {
  return {
    due: new Date(s.due),
    stability: s.stability,
    difficulty: s.difficulty,
    elapsed_days: s.elapsed_days,
    scheduled_days: s.scheduled_days,
    learning_steps: s.learning_steps,
    reps: s.reps,
    lapses: s.lapses,
    state: s.state,
    last_review: s.last_review ? new Date(s.last_review) : undefined,
  };
}

export function fromCard(c: Card, introducedOn: string): SrsData {
  return {
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    last_review: c.last_review ? c.last_review.getTime() : null,
    introducedOn,
  };
}

export function newSrs(today: string, now = new Date()): SrsData {
  return fromCard(createEmptyCard(now), today);
}

export function rate(s: SrsData, grade: Grade, now = new Date()): SrsData {
  const r = scheduler.next(toCard(s), now, grade);
  return fromCard(r.card, s.introducedOn);
}

export function previewIntervals(s: SrsData, now = new Date()): Record<number, string> {
  const p = scheduler.repeat(toCard(s), now);
  const out: Record<number, string> = {};
  for (const g of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as Grade[]) {
    out[g] = humanInterval(p[g].card.due.getTime() - now.getTime());
  }
  return out;
}

export function humanInterval(ms: number) {
  const min = ms / 60000;
  if (min < 60) return `${Math.max(1, Math.round(min))}m`;
  const h = min / 60;
  if (h < 24) return `${Math.round(h)}h`;
  const d = h / 24;
  if (d < 30) return `${Math.round(d)}d`;
  const mo = d / 30;
  if (mo < 12) return `${mo.toFixed(mo < 3 ? 1 : 0)}mo`;
  return `${(d / 365).toFixed(1)}y`;
}

export interface QueueInfo {
  due: Row<CardData>[];
  fresh: Row<CardData>[];
  newToday: number;
  reviewsToday: number;
  learned: number;
}

/**
 * Build today's queue. New cards come from topics unlocked by the curriculum week (current week first),
 * easier levels first. Cards you created (from mistakes or tutor sessions) always come first.
 * The Italian→English side of a note is introduced first; English→Italian follows on a later day.
 */
export function buildQueue(opts: {
  cards: Row<CardData>[];
  srs: Map<string, SrsData>;
  reviewsToday: number;
  today: string;
  now: number;
  cur: Curriculum;
  week: number;
  newPerDay: number;
  reviewCap: number;
  directions?: "production" | "both";
}): QueueInfo {
  const production = (opts.directions ?? "production") === "production";
  const { cards, srs, today, now, cur, week } = opts;
  const newToday = [...srs.values()].filter((s) => s.introducedOn === today).length;
  let learned = 0;
  const due: Row<CardData>[] = [];
  const candidates: Row<CardData>[] = [];
  const introducedBeforeToday = new Set<string>();
  for (const [id, s] of srs) if (s.introducedOn !== today) introducedBeforeToday.add(id);

  for (const c of cards) {
    if (c.data.suspended) continue;
    const s = srs.get(c.id);
    if (s) {
      if (s.state === 2) learned++;
      if (s.due <= now) due.push(c);
    } else if (!production || c.data.dir === "en2it") {
      candidates.push(c);
    }
  }
  // Most-forgotten first (lowest predicted recall), so stopping early still covers what matters most.
  const nowD = new Date(now);
  const recallOf = (s: SrsData) => {
    try {
      return scheduler.get_retrievability(toCard(s), nowD, false);
    } catch {
      return 0; // malformed state (e.g. missing last_review): treat as most urgent instead of crashing
    }
  };
  const recall = new Map(due.map((c) => [c.id, recallOf(srs.get(c.id)!)]));
  due.sort((a, b) => recall.get(a.id)! - recall.get(b.id)!);

  const topics = unlockedTopics(cur, week);
  const maxLevel = cur.weeks[Math.min(Math.max(week, 1), cur.weeks.length) - 1]?.level ?? 1;
  const topicRank = (t: string) => {
    const i = topics.indexOf(t);
    return i === -1 ? 99 : i;
  };
  const active = new Set(cards.filter((c) => !c.data.suspended).map((c) => c.id));
  const eligible = candidates.filter((c) => {
    // In "both" mode, a seed note's English→Italian card waits until its Italian→English card was
    // introduced on an earlier day (unless that card is missing or suspended). User cards skip this.
    if (!production && c.data.dir === "en2it" && c.data.source === "seed") {
      const sibling = c.id.replace(/:en2it$/, ":it2en");
      return introducedBeforeToday.has(sibling) || !active.has(sibling);
    }
    return true;
  });
  const score = (c: Row<CardData>) => {
    const user = c.data.source !== "seed" ? 0 : 1;
    const inScope = topicRank(c.data.topic) < 99 && c.data.level <= maxLevel ? 0 : 1;
    return [user, inScope, c.data.dir === "en2it" ? 0 : 1, c.data.level, topicRank(c.data.topic), c.data.order];
  };
  eligible.sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sa[i] - sb[i];
    return 0;
  });
  const freshCount = Math.max(0, opts.newPerDay - newToday);
  const reviewRoom = Math.max(0, opts.reviewCap - opts.reviewsToday);
  return {
    due: due.slice(0, reviewRoom),
    fresh: eligible.slice(0, freshCount),
    newToday,
    reviewsToday: opts.reviewsToday,
    learned,
  };
}

// ---------- Answer checking for speak-the-answer mode ----------

export function normalize(s: string) {
  return s
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[’`´]/g, "'")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/'/g, "' ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Hesitation words that speech recognition picks up; saying them around the answer is fine. */
const FILLERS = new Set(["eh", "ehm", "uhm", "um", "uh", "mm", "allora", "cioe", "dunque", "beh", "ok", "okay", "si"]);

const ARTICLES = new Set(["il", "lo", "la", "l'", "i", "gli", "le", "un", "uno", "una", "un'"]);

function lev(a: string[], b: string[]) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

function charSim(a: string, b: string) {
  if (!a && !b) return 1;
  const d = lev(a.split(""), b.split(""));
  return 1 - d / Math.max(a.length, b.length);
}

export type Verdict = "correct" | "close" | "wrong";

/** Compare what was heard against the expected Italian. Alternatives in the answer can be separated by "/" or ";". */
export function checkAnswer(heard: string, expected: string): { verdict: Verdict; score: number; articleOnly: boolean } {
  const h = normalize(heard);
  const options = expected.split(/[/;]/).map(normalize).filter(Boolean);
  let best = { verdict: "wrong" as Verdict, score: 0, articleOnly: false };
  for (const e of options) {
    if (!e) continue;
    if (!h) continue;
    if (h === e) return { verdict: "correct", score: 1, articleOnly: false };
    // The answer said as part of a longer utterance: compare whole words only ("la" must not match "lavoro").
    if (h && ` ${h} `.includes(` ${e} `)) {
      const extra = ` ${h} `.replace(` ${e} `, " ").trim().split(" ").filter(Boolean);
      const fillersOnly = extra.every((w) => FILLERS.has(w));
      const v = { verdict: (fillersOnly ? "correct" : "close") as Verdict, score: fillersOnly ? 1 : 0.8, articleOnly: false };
      if (v.score > best.score) best = v;
      continue;
    }
    const strip = (s: string) => s.split(" ").filter((w) => !ARTICLES.has(w)).join(" ");
    const articleOnly = strip(h) === strip(e) && strip(e).length > 0;
    const score = articleOnly ? 0.85 : charSim(h, e);
    const verdict: Verdict = score >= 0.93 ? "correct" : score >= 0.7 ? "close" : "wrong";
    if (score > best.score) best = { verdict, score, articleOnly };
  }
  return best;
}

/** Word-level diff used to highlight mismatches. Returns expected words flagged as matched or not. */
export function wordMatches(heard: string, expected: string): { word: string; ok: boolean }[] {
  const hw = new Set(normalize(heard).split(" "));
  return expected.split(/\s+/).filter(Boolean).map((w) => {
    const n = normalize(w);
    return { word: w, ok: !n || n.split(" ").every((x) => hw.has(x)) };
  });
}

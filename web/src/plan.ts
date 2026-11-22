import type { DayplanData, PlanBlock, Settings, TimelogData } from "./types";
import { addDays, daysBetween, localDate } from "./time";
import type { Row } from "./db";

export interface Week {
  week: number;
  phase: string;
  level: number;
  theme: string;
  grammar: string[];
  topics: string[];
  scenarios: string[];
  goal: string;
}

export interface Level {
  label: string;
  englishSupport: string;
  ttsRate: number;
}

export interface Curriculum {
  startDate: string;
  targetDate: string;
  weeklyTargetHours: number;
  plans: Record<string, PlanBlock[]>;
  levels: Record<string, Level>;
  weeks: Week[];
  scenarios: Record<string, { label: string; role: string; goal: string }>;
}

export const DEFAULT_SETTINGS: Settings = {
  name: "Anthony",
  startDate: "",
  targetDate: "",
  newPerDay: 25,
  reviewCap: 200,
  weeklyTargetHours: 0,
  sttMode: "auto",
  voiceURI: "",
  ttsRate: 0,
  lessonCourse: "Language Transfer — Complete Italian",
  lessonNext: 1,
  speakAnswers: true,
  sounds: false,
  cardDirections: "production",
  grading: "two",
  autoAdvance: true,
  autoCards: true,
  celebrations: false,
  autoplay: true,
};

export function effectiveSettings(s: Partial<Settings> | undefined, cur: Curriculum | undefined): Settings {
  const out = { ...DEFAULT_SETTINGS, ...(s ?? {}) };
  if (!out.startDate) out.startDate = cur?.startDate ?? localDate();
  if (!out.targetDate) out.targetDate = cur?.targetDate ?? addDays(localDate(), 63);
  if (!out.weeklyTargetHours) out.weeklyTargetHours = cur?.weeklyTargetHours ?? 14;
  return out;
}

/** 0 = before the start date; otherwise 1..N (clamped to the last week). */
export function weekNumber(settings: Settings, cur: Curriculum, today = localDate()): number {
  const d = daysBetween(settings.startDate, today);
  if (d < 0) return 0;
  return Math.min(Math.floor(d / 7) + 1, cur.weeks.length);
}

export function weekInfo(settings: Settings, cur: Curriculum, today = localDate()) {
  const n = weekNumber(settings, cur, today);
  const week = cur.weeks[Math.max(n, 1) - 1];
  return { n, week, level: cur.levels[String(week.level)] };
}

export function blocksFor(mode: "full" | "short", week: Week, cur: Curriculum): PlanBlock[] {
  return mode === "short" ? cur.plans.short : cur.plans[week.phase] ?? cur.plans.foundation;
}

export const STREAK_MIN = 30;

export function minutesByDate(logs: Row<TimelogData>[]) {
  const m = new Map<string, number>();
  for (const l of logs) m.set(l.data.date, (m.get(l.data.date) ?? 0) + (Number(l.data.minutes) || 0));
  return m;
}

export function streak(byDate: Map<string, number>, today = localDate()) {
  let n = 0;
  let d = (byDate.get(today) ?? 0) >= STREAK_MIN ? today : addDays(today, -1);
  while ((byDate.get(d) ?? 0) >= STREAK_MIN) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

export function emptyPlan(date: string): DayplanData {
  return { date, mode: "full", done: {} };
}

/** Topics unlocked up to and including the given week (current week's topics first). */
export function unlockedTopics(cur: Curriculum, n: number): string[] {
  const out: string[] = [];
  const upto = Math.min(Math.max(n, 1), cur.weeks.length);
  for (let i = upto - 1; i >= 0; i--) for (const t of cur.weeks[i].topics) if (!out.includes(t)) out.push(t);
  return out;
}

import type { FastifyInstance } from "fastify";
import { getDoc, listDocs } from "./db.js";
import { curriculum, isDate } from "./seed.js";
import { addDays, daysBetween, localDate } from "./time.js";

export const STREAK_MIN_MINUTES = 30;

export function computeStats(today = localDate()) {
  const cur = curriculum();
  const settings = getDoc("settings", "main")?.data ?? {};
  // Settings are client-written: never trust their shape.
  const startDate: string = isDate(settings.startDate) ? settings.startDate : cur.startDate;
  const targetDate: string = isDate(settings.targetDate) ? settings.targetDate : cur.targetDate;
  const wt = Number(settings.weeklyTargetHours);
  const weeklyTarget: number = Number.isFinite(wt) && wt > 0 ? wt : Number(cur.weeklyTargetHours) || 14;

  const logs = listDocs("timelogs")
    .map((d) => d.data as { date: string; block: string; minutes: number })
    .filter((l) => l && isDate(l.date));
  const byDate = new Map<string, number>();
  let totalMin = 0;
  let speakingMin = 0;
  for (const l of logs) {
    const m = Math.max(0, Math.min(Number(l.minutes) || 0, 24 * 60));
    totalMin += m;
    byDate.set(l.date, (byDate.get(l.date) ?? 0) + m);
    if (l.block === "speaking" || l.block === "tutor") speakingMin += m;
  }

  // Streak: consecutive days with >= 30 min logged, ending today (or yesterday if today isn't done yet).
  let streak = 0;
  let d = (byDate.get(today) ?? 0) >= STREAK_MIN_MINUTES ? today : addDays(today, -1);
  while ((byDate.get(d) ?? 0) >= STREAK_MIN_MINUTES) {
    streak++;
    d = addDays(d, -1);
  }

  const nWeeks = cur.weeks.length;
  const dayIdx = daysBetween(startDate, today);
  const week = Math.min(Math.max(Math.floor(dayIdx / 7) + 1, 1), nWeeks);
  const weeks = cur.weeks.map((w: any) => {
    let min = 0;
    for (let i = 0; i < 7; i++) min += byDate.get(addDays(startDate, (w.week - 1) * 7 + i)) ?? 0;
    if (w.week === 1) for (const [d, v] of byDate) if (d < startDate) min += v; // pre-start time counts toward week 1
    return { week: w.week, hours: +(min / 60).toFixed(2), targetHours: weeklyTarget };
  });

  const srs = listDocs("srs").map((x) => x.data as { state: number });
  const cardsLearned = srs.filter((s) => s?.state === 2).length;
  const cardsStarted = srs.length;

  const wk = cur.weeks[week - 1];
  const plan = getDoc("dayplans", today)?.data ?? { mode: "full", done: {} };
  const blocks: any[] = (plan.mode === "short" ? cur.plans.short : cur.plans[wk.phase]) ?? [];
  const done = blocks.filter((b) => plan.done?.[b.id]).length;

  const mistakes = listDocs("mistakes").map((m) => m.data as { type: string; date: string });
  const mistakesByType: Record<string, number> = {};
  for (const m of mistakes) {
    const t = typeof m?.type === "string" ? m.type : "other";
    mistakesByType[t] = (mistakesByType[t] ?? 0) + 1;
  }

  return {
    date: today,
    startDate,
    targetDate,
    daysUntilTarget: Math.max(daysBetween(today, targetDate), 0),
    curriculumWeek: dayIdx < 0 ? 0 : week,
    streakDays: streak,
    totalHours: +(totalMin / 60).toFixed(2),
    speakingMinutes: Math.round(speakingMin),
    cardsLearned,
    cardsStarted,
    weeklyTargetHours: weeklyTarget,
    thisWeekHours: weeks[Math.max(week, 1) - 1]?.hours ?? 0,
    weeks,
    mistakes: { total: mistakes.length, byType: mistakesByType },
    today: {
      mode: plan.mode,
      minutesLogged: Math.round(byDate.get(today) ?? 0),
      blocksDone: done,
      blocksTotal: blocks.length,
      complete: blocks.length > 0 && done === blocks.length,
      streakSafe: (byDate.get(today) ?? 0) >= STREAK_MIN_MINUTES,
    },
  };
}

export function registerStats(app: FastifyInstance) {
  app.get("/api/stats", async (_req, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    return computeStats();
  });
}

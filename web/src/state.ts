import { useEffect, useState, useSyncExternalStore } from "react";
import { patch, put, useDoc } from "./db";
import { effectiveSettings, emptyPlan, weekInfo, type Curriculum } from "./plan";
import { setTtsPrefs } from "./speech";
import { localDate, uid } from "./time";
import type { BlockKind, DayplanData, MistakeData, Settings, TimelogData } from "./types";

export function useToday() {
  const [today, setToday] = useState(localDate());
  useEffect(() => {
    const t = setInterval(() => setToday(localDate()), 30_000);
    return () => clearInterval(t);
  }, []);
  return today;
}

export function useApp() {
  const cur = useDoc<Curriculum>("meta", "curriculum");
  const rawSettings = useDoc<Partial<Settings>>("settings", "main");
  const today = useToday();
  if (!cur) return null;
  const settings = effectiveSettings(rawSettings ?? undefined, cur);
  const wk = weekInfo(settings, cur, today);
  setTtsPrefs({ voiceURI: settings.voiceURI, rate: settings.ttsRate || wk.level.ttsRate });
  return { cur, settings, today, ...wk, ttsRate: settings.ttsRate || wk.level.ttsRate };
}
export type AppCtx = NonNullable<ReturnType<typeof useApp>>;

export async function saveSettings(partial: Partial<Settings>) {
  await patch<Partial<Settings>>("settings", "main", (old) => ({ ...(old ?? {}), ...partial }));
}

export async function logTime(entry: { block: BlockKind; minutes: number; note?: string; blockId?: string; date?: string }) {
  const date = entry.date ?? localDate();
  const id = uid();
  const data: TimelogData = {
    date,
    block: entry.block,
    blockId: entry.blockId,
    minutes: Math.max(0, Math.round(entry.minutes)),
    note: entry.note ?? "",
    ts: Date.now(),
  };
  await put("timelogs", id, data);
  if (entry.blockId) {
    await patch<DayplanData>("dayplans", date, (old) => {
      const p = old ?? emptyPlan(date);
      return { ...p, done: { ...p.done, [entry.blockId!]: id } };
    });
  }
  return id;
}

export async function setDayMode(date: string, mode: "full" | "short") {
  await patch<DayplanData>("dayplans", date, (old) => ({ ...(old ?? emptyPlan(date)), mode }));
}

export async function addMistake(m: Omit<MistakeData, "date" | "ts"> & { date?: string }) {
  const id = uid();
  await put<MistakeData>("mistakes", id, { ...m, date: m.date ?? localDate(), ts: Date.now() });
  return id;
}

// ---------- Active block timer (persists across screens and reloads) ----------

export interface ActiveBlock {
  blockId?: string;
  kind: BlockKind;
  label: string;
  planned: number;
  startedAt: number;
  date: string;
}

const KEY = "parla.activeBlock";
const listeners = new Set<() => void>();
let active: ActiveBlock | null = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "null");
  } catch {
    return null;
  }
})();

export function setActiveBlock(b: ActiveBlock | null) {
  active = b;
  if (b) localStorage.setItem(KEY, JSON.stringify(b));
  else localStorage.removeItem(KEY);
  listeners.forEach((l) => l());
}
export const getActiveBlock = () => active;
export const useActiveBlock = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => active,
  );

export function elapsedMinutes(b: ActiveBlock) {
  return Math.max(1, Math.round((Date.now() - b.startedAt) / 60000));
}

// ---------- Tiny hash router ----------
export function useRoute() {
  const [hash, setHash] = useState(location.hash || "#/today");
  useEffect(() => {
    const on = () => setHash(location.hash || "#/today");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const [path, query = ""] = hash.slice(1).split("?");
  return { path, params: new URLSearchParams(query) };
}
export const go = (path: string) => {
  location.hash = path;
};

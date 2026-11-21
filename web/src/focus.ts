import { all } from "./db";
import type { CardData, MistakeData, SrsData } from "./types";
import { addDays, localDate } from "./time";

const strip = (s: string) => s.replace(/\s*\(.*?\)\s*/g, " ").trim();

/**
 * What the AI partner should steer the conversation toward:
 * correct forms of recent (especially repeated) mistakes, the words you keep forgetting,
 * and words you started this week.
 */
export async function buildFocus(): Promise<{ words: string[]; mistakes: string[] }> {
  const [mistakes, cards, srs] = await Promise.all([all<MistakeData>("mistakes"), all<CardData>("cards"), all<SrsData>("srs")]);
  const since = addDays(localDate(), -14);
  const counts = new Map<string, number>();
  for (const m of mistakes) if (m.data.date >= since && m.data.corrected) counts.set(m.data.corrected, (counts.get(m.data.corrected) ?? 0) + 1);
  const mistakeForms = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k).slice(0, 6);

  const byId = new Map(cards.map((c) => [c.id, c.data]));
  const weekAgo = addDays(localDate(), -7);
  const weak: { it: string; score: number }[] = [];
  const fresh: string[] = [];
  for (const s of srs) {
    const c = byId.get(s.id);
    if (!c) continue;
    if (s.data.lapses > 0) weak.push({ it: strip(c.it), score: s.data.lapses });
    else if (s.data.introducedOn >= weekAgo) fresh.push(strip(c.it));
  }
  const words = [...new Set([...weak.sort((a, b) => b.score - a.score).map((w) => w.it).slice(0, 5), ...fresh.reverse().slice(0, 5)])];
  return { words: words.slice(0, 10), mistakes: mistakeForms };
}

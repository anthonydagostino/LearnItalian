export function localDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const utc = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));

export function daysBetween(a: string, b: string): number {
  return Math.round((utc(b) - utc(a)) / 86_400_000);
}

export function addDays(d: string, n: number): string {
  return new Date(utc(d) + n * 86_400_000).toISOString().slice(0, 10);
}

export function prettyDate(d: string): string {
  return new Date(utc(d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function fmtMinutes(min: number): string {
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

export const uid = () =>
  (crypto as any).randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

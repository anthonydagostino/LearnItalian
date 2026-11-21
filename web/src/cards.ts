import { all, putMany } from "./db";
import { uid } from "./time";
import type { CardData } from "./types";

/** Create both directions of a user card (from a mistake, tutor session, or manual entry). Returns the it2en card id. */
export async function createNote(n: {
  it: string;
  en: string;
  ex?: string;
  exEn?: string;
  notes?: string;
  source: CardData["source"];
  topic?: string;
}): Promise<string> {
  const it = n.it.trim();
  const en = n.en.trim();
  // Avoid duplicates of a user card with the same Italian text.
  const existing = (await all<CardData>("cards")).find(
    (c) => c.data.source !== "seed" && c.data.it.trim().toLowerCase() === it.toLowerCase() && c.data.dir === "it2en",
  );
  if (existing) return existing.id;
  const noteId = `user:${uid()}`;
  const base = {
    noteId,
    topic: n.topic ?? (n.source === "tutor" ? "tutor" : n.source === "mistake" ? "mistakes" : "my_cards"),
    it,
    en,
    ex: n.ex ?? "",
    exEn: n.exEn ?? "",
    notes: n.notes ?? "",
    kind: it.includes(" ") ? ("phrase" as const) : ("word" as const),
    level: 1,
    order: 0,
    source: n.source,
    createdAt: Date.now(),
  };
  await putMany<CardData>("cards", [
    { id: `${noteId}:it2en`, data: { ...base, dir: "it2en" } },
    { id: `${noteId}:en2it`, data: { ...base, dir: "en2it" } },
  ]);
  return `${noteId}:it2en`;
}

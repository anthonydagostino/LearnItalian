import curriculumJson from "../../../seed/curriculum.json";
import type { Row } from "../db";
import type { Curriculum } from "../plan";
import { newSrs } from "../srs";
import type { CardData, SrsData } from "../types";

export const cur = curriculumJson as unknown as Curriculum;

let order = 0;
export function card(it: string, en: string, opts: Partial<CardData> & { dir?: CardData["dir"] } = {}): Row<CardData> {
  const topic = opts.topic ?? "greetings";
  const noteId = opts.noteId ?? `${topic}:${it}`;
  const dir = opts.dir ?? "it2en";
  return {
    id: `${noteId}:${dir}`,
    updated_at: 0,
    data: { noteId, dir, topic, it, en, ex: `${it} oggi.`, exEn: `${en} today.`, kind: "word", level: 1, order: order++, source: "seed", ...opts },
  };
}

/** Both directions of a note. */
export const note = (it: string, en: string, opts: Partial<CardData> = {}) => [card(it, en, { ...opts, dir: "it2en" }), card(it, en, { ...opts, dir: "en2it" })];

export function srsState(partial: Partial<SrsData> = {}, today = "2026-11-20"): SrsData {
  return { ...newSrs(today, new Date("2026-11-20T10:00:00Z")), ...partial };
}

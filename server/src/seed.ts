import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { getDoc, listDocs, putDoc, tx } from "./db.js";

export interface SeedItem {
  it: string;
  en: string;
  ex?: string;
  ex_en?: string;
  kind?: "word" | "phrase";
  level?: number;
  notes?: string;
  flag?: string;
}

export function slug(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export function loadCurriculum(): any {
  return JSON.parse(fs.readFileSync(path.join(config.seedDir, "curriculum.json"), "utf8"));
}

let curriculumCache: any = null;
export function curriculum(): any {
  if (!curriculumCache) curriculumCache = loadCurriculum();
  return curriculumCache;
}

function sameJson(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Write a doc only if its content changed (avoids churning sync revisions on every boot). */
function putIfChanged(collection: string, id: string, data: unknown, now: number) {
  const existing = getDoc(collection, id);
  if (existing && sameJson(existing.data, data)) return false;
  putDoc({ collection, id, data, updated_at: now });
  return true;
}

export function importSeed() {
  const now = Date.now();
  const deckDir = path.join(config.seedDir, "deck");
  const files = fs.existsSync(deckDir)
    ? fs.readdirSync(deckDir).filter((f) => f.endsWith(".json")).sort()
    : [];

  const topics: { topic: string; title: string; count: number }[] = [];
  const seen = new Map<string, string>();
  const wanted = new Set<string>();
  let changed = 0;
  const warnings: string[] = [];

  tx(() => {
    files.forEach((file, fileIdx) => {
      let deck: { topic: string; title: string; items: SeedItem[] };
      try {
        deck = JSON.parse(fs.readFileSync(path.join(deckDir, file), "utf8"));
      } catch (e) {
        warnings.push(`${file}: invalid JSON (${(e as Error).message})`);
        return;
      }
      const topic = deck.topic || path.basename(file, ".json");
      topics.push({ topic, title: deck.title || topic, count: deck.items.length });
      deck.items.forEach((item, idx) => {
        if (!item.it || !item.en) {
          warnings.push(`${file}#${idx}: missing it/en`);
          return;
        }
        const key = slug(item.it);
        // Cross-file duplicates: skip only when the meaning matches too (homographs like
        // "piacere" = nice to meet you / to please are kept).
        const meaningKey = `${key}|${slug(item.en).slice(0, 6)}`;
        if (seen.has(meaningKey)) {
          warnings.push(`duplicate "${item.it}" in ${file} (already in ${seen.get(meaningKey)}) — skipped`);
          return;
        }
        seen.set(meaningKey, file);
        let noteId = `${topic}:${key}`;
        while (wanted.has(`${noteId}:it2en`)) noteId += "-2";
        for (const dir of ["it2en", "en2it"] as const) {
          const id = `${noteId}:${dir}`;
          wanted.add(id);
          const data = {
            noteId,
            dir,
            topic,
            it: item.it,
            en: item.en,
            ex: item.ex ?? "",
            exEn: item.ex_en ?? "",
            notes: item.notes ?? "",
            flag: item.flag ?? "",
            kind: item.kind ?? "word",
            level: item.level ?? 2,
            order: fileIdx * 1000 + idx,
            source: "seed",
          };
          if (putIfChanged("cards", id, data, now)) changed++;
        }
      });
    });

    // Soft-delete seed cards that were removed from the files.
    for (const d of listDocs("cards")) {
      if (d.data?.source === "seed" && !wanted.has(d.id)) {
        putDoc({ collection: "cards", id: d.id, data: d.data, updated_at: now, deleted: true });
        changed++;
      }
    }

    putIfChanged("meta", "topics", topics, now);
    curriculumCache = loadCurriculum();
    putIfChanged("meta", "curriculum", curriculumCache, now);
  });

  return { files: files.length, cards: wanted.size, changed, warnings };
}

import crypto from "node:crypto";
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

/** Minimal shape check so a typo in curriculum.json can't take the app down. */
export function validateCurriculum(c: any) {
  if (!c || typeof c !== "object") throw new Error("not an object");
  if (!Array.isArray(c.weeks) || c.weeks.length === 0) throw new Error("weeks must be a non-empty array");
  for (const w of c.weeks) {
    if (typeof w?.week !== "number" || typeof w?.phase !== "string" || !c.levels?.[String(w.level)]) throw new Error(`week ${w?.week}: needs week, phase and a valid level`);
    if (!Array.isArray(c.plans?.[w.phase])) throw new Error(`week ${w.week}: no plan for phase "${w.phase}"`);
    for (const k of ["topics", "scenarios", "grammar"]) if (!Array.isArray(w[k])) throw new Error(`week ${w.week}: ${k} must be an array`);
  }
  if (!Array.isArray(c.plans?.short)) throw new Error("plans.short is required");
  if (!c.scenarios?.free) throw new Error('scenarios.free is required');
  if (!isDate(c.startDate) || !isDate(c.targetDate)) throw new Error("startDate/targetDate must be YYYY-MM-DD");
  return c;
}
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

const STOP = new Set(["to", "the", "a", "an", "of", "on", "in", "at", "i", "you", "it", "is", "be", "lit", "and", "or", "my", "your", "m", "f", "s", "d", "informal", "formal", "phone", "for", "with"]);

/** Content words of an English gloss, used to tell duplicates ("the café" / "café, coffee bar") from homographs. */
export function meaningWords(en: string): Set<string> {
  return new Set(
    en
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/[^a-z]+/)
      .filter((w) => w.length > 1 && !STOP.has(w)),
  );
}

export function sameMeaning(a: string, b: string) {
  const wa = meaningWords(a);
  const wb = meaningWords(b);
  // Glosses made only of stopwords ("And you?") are compared whole.
  if (!wa.size || !wb.size) return slug(a.replace(/\(.*?\)/g, "")) === slug(b.replace(/\(.*?\)/g, ""));
  for (const w of wb) if (wa.has(w)) return true;
  return false;
}

function shortHash(s: string) {
  return crypto.createHash("sha1").update(s).digest("hex").slice(0, 6);
}

const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
export { isDate };

export function importSeed() {
  const now = Date.now();
  const deckDir = path.join(config.seedDir, "deck");
  const files = fs.existsSync(deckDir)
    ? fs.readdirSync(deckDir).filter((f) => f.endsWith(".json")).sort()
    : [];

  const topics: { topic: string; title: string; count: number }[] = [];
  const seen = new Map<string, { file: string; en: string }[]>();
  const wanted = new Set<string>();
  const failedTopics = new Set<string>();
  let changed = 0;
  const warnings: string[] = [];

  tx(() => {
    files.forEach((file, fileIdx) => {
      const fallbackTopic = path.basename(file, ".json");
      let deck: unknown;
      try {
        deck = JSON.parse(fs.readFileSync(path.join(deckDir, file), "utf8"));
      } catch (e) {
        warnings.push(`${file}: invalid JSON (${(e as Error).message}); its cards were left untouched`);
        failedTopics.add(fallbackTopic);
        return;
      }
      const d = deck as { topic?: unknown; title?: unknown; items?: unknown } | null;
      if (!d || typeof d !== "object" || !Array.isArray(d.items)) {
        warnings.push(`${file}: expected {"topic", "title", "items": [...]}; its cards were left untouched`);
        failedTopics.add(fallbackTopic);
        return;
      }
      const topic = typeof d.topic === "string" && d.topic ? d.topic : fallbackTopic;
      const items = d.items as unknown[];
      topics.push({ topic, title: typeof d.title === "string" && d.title ? d.title : topic, count: items.length });

      // Items whose Italian text collides within this file (homographs) get a suffix derived from
      // their meaning, so IDs don't depend on file order.
      const slugCount = new Map<string, number>();
      for (const it of items) {
        const x = it as SeedItem | null;
        if (x && typeof x === "object" && typeof x.it === "string") slugCount.set(slug(x.it), (slugCount.get(slug(x.it)) ?? 0) + 1);
      }

      items.forEach((raw, idx) => {
        const item = raw as SeedItem | null;
        if (!item || typeof item !== "object" || typeof item.it !== "string" || typeof item.en !== "string" || !item.it.trim() || !item.en.trim()) {
          warnings.push(`${file}#${idx}: missing or invalid "it"/"en"`);
          return;
        }
        const key = slug(item.it);
        if (!key) {
          warnings.push(`${file}#${idx}: "${item.it}" has no usable characters`);
          return;
        }
        // Cross-file duplicates: skip only when the meaning overlaps too (homographs like
        // "piacere" = nice to meet you / to like are kept).
        const prior = (seen.get(key) ?? []).find((p) => p.file !== file && sameMeaning(p.en, item.en));
        if (prior) {
          warnings.push(`duplicate "${item.it}" in ${file} (already in ${prior.file}) — skipped`);
          return;
        }
        seen.set(key, [...(seen.get(key) ?? []), { file, en: item.en }]);
        let noteId = `${topic}:${key}`;
        if ((slugCount.get(key) ?? 0) > 1) noteId += `~${shortHash(item.en)}`;
        if (wanted.has(`${noteId}:it2en`)) {
          warnings.push(`${file}#${idx}: "${item.it}" duplicates another item in the same file — skipped`);
          return;
        }
        for (const dir of ["it2en", "en2it"] as const) {
          const id = `${noteId}:${dir}`;
          wanted.add(id);
          const existing = getDoc("cards", id);
          const data = {
            noteId,
            dir,
            topic,
            it: item.it,
            en: item.en,
            ex: typeof item.ex === "string" ? item.ex : "",
            exEn: typeof item.ex_en === "string" ? item.ex_en : "",
            notes: typeof item.notes === "string" ? item.notes : "",
            flag: typeof item.flag === "string" ? item.flag : "",
            kind: item.kind === "phrase" ? "phrase" : "word",
            level: [1, 2, 3].includes(Number(item.level)) ? Number(item.level) : 2,
            order: fileIdx * 1000 + idx,
            source: "seed",
            // Preserve choices the user made on this card (e.g. suspending it).
            ...(existing?.data?.suspended ? { suspended: true } : {}),
          };
          if (putIfChanged("cards", id, data, now)) changed++;
        }
      });
    });

    // Soft-delete seed cards that were removed from the files — but never when a file failed to load
    // (its cards would all look "removed") or when no deck files were found at all.
    // A file that failed to parse can't tell us which topic it held, so any failure skips deletion.
    if (files.length > 0 && failedTopics.size === 0) {
      for (const d of listDocs("cards")) {
        if (d.data?.source !== "seed" || wanted.has(d.id)) continue;
        putDoc({ collection: "cards", id: d.id, data: d.data, updated_at: now, deleted: true });
        changed++;
      }
    } else if (files.length === 0) {
      warnings.push(`no deck files found in ${deckDir}; existing cards were left untouched`);
    }

    putIfChanged("meta", "topics", topics, now);
    try {
      curriculumCache = validateCurriculum(loadCurriculum());
      putIfChanged("meta", "curriculum", curriculumCache, now);
    } catch (e) {
      const prev = getDoc("meta", "curriculum")?.data;
      if (!prev) throw new Error(`seed/curriculum.json is invalid and there is no previous copy: ${(e as Error).message}`, { cause: e });
      curriculumCache = prev;
      warnings.push(`curriculum.json is invalid (${(e as Error).message}); kept the previous version`);
    }
  });

  return { files: files.length, cards: wanted.size, changed, warnings };
}

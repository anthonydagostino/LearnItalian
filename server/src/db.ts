import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

fs.mkdirSync(config.dataDir, { recursive: true });
export const db = new Database(path.join(config.dataDir, "parla.db"));
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

db.exec(`
CREATE TABLE IF NOT EXISTS docs (
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  rev INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (collection, id)
);
CREATE INDEX IF NOT EXISTS docs_rev ON docs(rev);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- Raw Claude API message history per conversation (server-only, not synced)
CREATE TABLE IF NOT EXISTS chat_api (id TEXT PRIMARY KEY, messages TEXT NOT NULL);
`);

/** Collections the client may write to. Server-only collections are read-only for clients. */
export const CLIENT_WRITABLE = new Set([
  "cards", "srs", "reviews", "timelogs", "dayplans", "mistakes", "tutor", "settings", "conversations",
]);

export interface DocRow {
  collection: string;
  id: string;
  data: string;
  updated_at: number;
  rev: number;
  deleted: number;
}

export interface Doc<T = any> {
  collection: string;
  id: string;
  data: T;
  updated_at: number;
  deleted?: boolean;
}

const maxRevStmt = db.prepare("SELECT COALESCE(MAX(rev), 0) AS r FROM docs");
const getStmt = db.prepare("SELECT * FROM docs WHERE collection = ? AND id = ?");
const upsertStmt = db.prepare(`
  INSERT INTO docs (collection, id, data, updated_at, rev, deleted)
  VALUES (@collection, @id, @data, @updated_at, @rev, @deleted)
  ON CONFLICT(collection, id) DO UPDATE SET
    data = excluded.data, updated_at = excluded.updated_at, rev = excluded.rev, deleted = excluded.deleted
`);

export function currentRev(): number {
  return (maxRevStmt.get() as { r: number }).r;
}

export function getDoc<T = any>(collection: string, id: string): Doc<T> | null {
  const row = getStmt.get(collection, id) as DocRow | undefined;
  if (!row || row.deleted) return null;
  return { collection, id, data: JSON.parse(row.data), updated_at: row.updated_at };
}

/**
 * Write a document. With `lww` the write only applies if it is newer than what we have
 * (last-write-wins on the client-supplied updated_at). Returns true if written.
 */
export function putDoc(doc: Doc, opts: { lww?: boolean } = {}): boolean {
  const existing = getStmt.get(doc.collection, doc.id) as DocRow | undefined;
  if (opts.lww && existing && existing.updated_at >= doc.updated_at) return false;
  upsertStmt.run({
    collection: doc.collection,
    id: doc.id,
    data: JSON.stringify(doc.data ?? {}),
    updated_at: doc.updated_at,
    rev: currentRev() + 1,
    deleted: doc.deleted ? 1 : 0,
  });
  return true;
}

export function listDocs<T = any>(collection: string): Doc<T>[] {
  const rows = db
    .prepare("SELECT * FROM docs WHERE collection = ? AND deleted = 0")
    .all(collection) as DocRow[];
  return rows.map((r) => ({ collection, id: r.id, data: JSON.parse(r.data), updated_at: r.updated_at }));
}

export function changesSince(since: number, limit: number) {
  const rows = db
    .prepare("SELECT * FROM docs WHERE rev > ? ORDER BY rev ASC LIMIT ?")
    .all(since, limit) as DocRow[];
  return rows.map((r) => ({
    collection: r.collection,
    id: r.id,
    data: JSON.parse(r.data),
    updated_at: r.updated_at,
    deleted: !!r.deleted,
    rev: r.rev,
  }));
}

export const tx = <T>(fn: () => T): T => db.transaction(fn)();

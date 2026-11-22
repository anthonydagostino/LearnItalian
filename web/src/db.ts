import Dexie, { type Table } from "dexie";
import { useLiveQuery } from "dexie-react-hooks";

export interface LocalDoc<T = any> {
  c: string; // collection
  id: string;
  data: T;
  updated_at: number;
  deleted: 0 | 1;
  dirty: 0 | 1;
  /** updated_at of the server version this local edit is based on (lets the server accept edits from a slow-clock device). */
  base?: number;
  /** Local write counter; sync compares it to know whether a doc changed while it was being pushed. */
  wv?: number;
}

class ParlaDB extends Dexie {
  docs!: Table<LocalDoc, [string, string]>;
  kv!: Table<{ key: string; value: any }, string>;
  constructor(name = "parla") {
    super(name);
    this.version(1).stores({
      docs: "[c+id], c, dirty",
      kv: "key",
    });
  }
}

export const db = new ParlaDB();

type Listener = () => void;
const writeListeners = new Set<Listener>();
export const onLocalWrite = (fn: Listener) => {
  writeListeners.add(fn);
  return () => writeListeners.delete(fn);
};
const notify = () => writeListeners.forEach((fn) => fn());

let writeCounter = 0;
const nextWv = () => Date.now() * 1000 + (writeCounter = (writeCounter + 1) % 1000);

export interface Row<T> {
  id: string;
  data: T;
  updated_at: number;
}

export async function all<T>(c: string): Promise<Row<T>[]> {
  const rows = await db.docs.where("c").equals(c).toArray();
  return rows.filter((r) => !r.deleted).map((r) => ({ id: r.id, data: r.data as T, updated_at: r.updated_at }));
}

export async function get<T>(c: string, id: string): Promise<T | undefined> {
  const r = await db.docs.get([c, id]);
  return r && !r.deleted ? (r.data as T) : undefined;
}

/** A local edit: marks the doc dirty and keeps the server version it was based on. */
function localRow<T>(c: string, id: string, data: T, old: LocalDoc | undefined, deleted: 0 | 1 = 0): LocalDoc<T> {
  return { c, id, data, updated_at: Date.now(), deleted, dirty: 1, base: old?.base, wv: nextWv() };
}

export async function put<T>(c: string, id: string, data: T) {
  await db.transaction("rw", db.docs, async () => {
    const old = await db.docs.get([c, id]);
    await db.docs.put(localRow(c, id, data, old));
  });
  notify();
}

export async function putMany<T>(c: string, rows: { id: string; data: T }[]) {
  await db.transaction("rw", db.docs, async () => {
    const olds = await db.docs.bulkGet(rows.map((r) => [c, r.id] as [string, string]));
    await db.docs.bulkPut(rows.map((r, i) => localRow(c, r.id, r.data, olds[i])));
  });
  notify();
}

export async function patch<T>(c: string, id: string, fn: (old: T | undefined) => T) {
  await db.transaction("rw", db.docs, async () => {
    const old = await db.docs.get([c, id]);
    await db.docs.put(localRow(c, id, fn(old && !old.deleted ? (old.data as T) : undefined), old));
  });
  notify();
}

export async function remove(c: string, id: string) {
  await db.transaction("rw", db.docs, async () => {
    const old = await db.docs.get([c, id]);
    await db.docs.put(localRow(c, id, old?.data ?? {}, old, 1));
  });
  notify();
}

/**
 * Cache a server-owned doc locally without marking it dirty (e.g. a conversation the server just created),
 * so the UI can show it before the next sync. The server copy replaces it on the next pull.
 */
export async function cacheServerDoc<T>(c: string, id: string, data: T) {
  const old = await db.docs.get([c, id]);
  if (old) return; // a synced or locally edited copy is always at least as fresh
  await db.docs.put({ c, id, data, updated_at: 0, deleted: 0, dirty: 0 });
  notify();
}

export function useCollection<T>(c: string): Row<T>[] | undefined {
  return useLiveQuery(() => all<T>(c), [c]);
}

export function useDoc<T>(c: string, id: string): T | undefined | null {
  // null = loading, undefined = missing
  const v = useLiveQuery(async () => ({ v: await get<T>(c, id) }), [c, id]);
  return v === undefined ? null : v.v;
}

export async function kvGet<T>(key: string, fallback: T): Promise<T> {
  const r = await db.kv.get(key);
  return r ? (r.value as T) : fallback;
}
export async function kvSet(key: string, value: unknown) {
  await db.kv.put({ key, value });
}

import Dexie, { type Table } from "dexie";
import { useLiveQuery } from "dexie-react-hooks";

export interface LocalDoc<T = any> {
  c: string; // collection
  id: string;
  data: T;
  updated_at: number;
  deleted: 0 | 1;
  dirty: 0 | 1;
}

class ParlaDB extends Dexie {
  docs!: Table<LocalDoc, [string, string]>;
  kv!: Table<{ key: string; value: any }, string>;
  constructor() {
    super("parla");
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

export async function put<T>(c: string, id: string, data: T) {
  await db.docs.put({ c, id, data, updated_at: Date.now(), deleted: 0, dirty: 1 });
  notify();
}

export async function putMany<T>(c: string, rows: { id: string; data: T }[]) {
  const now = Date.now();
  await db.docs.bulkPut(rows.map((r) => ({ c, id: r.id, data: r.data, updated_at: now, deleted: 0 as const, dirty: 1 as const })));
  notify();
}

export async function patch<T>(c: string, id: string, fn: (old: T | undefined) => T) {
  await db.transaction("rw", db.docs, async () => {
    const old = await get<T>(c, id);
    await db.docs.put({ c, id, data: fn(old), updated_at: Date.now(), deleted: 0, dirty: 1 });
  });
  notify();
}

export async function remove(c: string, id: string) {
  const r = await db.docs.get([c, id]);
  await db.docs.put({ c, id, data: r?.data ?? {}, updated_at: Date.now(), deleted: 1, dirty: 1 });
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

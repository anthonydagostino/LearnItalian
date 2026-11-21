import { useSyncExternalStore } from "react";
import { api } from "./api";
import { db, kvGet, kvSet, onLocalWrite } from "./db";

export interface SyncState {
  status: "idle" | "syncing" | "offline" | "error";
  lastSync: number | null;
  error?: string;
  pending: number;
}

let state: SyncState = { status: "idle", lastSync: null, pending: 0 };
const listeners = new Set<() => void>();
function set(s: Partial<SyncState>) {
  state = { ...state, ...s };
  listeners.forEach((l) => l());
}
export const useSyncState = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );

let running: Promise<void> | null = null;
let again = false;

export function sync(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = doSync().finally(() => {
    running = null;
    if (again) {
      again = false;
      void sync();
    }
  });
  return running;
}

async function doSync() {
  if (!navigator.onLine) {
    set({ status: "offline", pending: await db.docs.where("dirty").equals(1).count() });
    return;
  }
  set({ status: "syncing" });
  try {
    const dirty = await db.docs.where("dirty").equals(1).toArray();
    let since = await kvGet<number>("lastRev", 0);
    let first = true;
    for (;;) {
      const res = await api<{ rev: number; more: boolean; changes: any[] }>("/api/sync", {
        since,
        changes: first
          ? dirty.map((d) => ({ collection: d.c, id: d.id, data: d.data, updated_at: d.updated_at, deleted: !!d.deleted }))
          : [],
      });
      await db.transaction("rw", db.docs, async () => {
        if (first) {
          // Mark pushed docs clean unless they were modified again while we were syncing.
          for (const d of dirty) {
            const cur = await db.docs.get([d.c, d.id]);
            if (cur && cur.updated_at === d.updated_at) await db.docs.update([d.c, d.id], { dirty: 0 });
          }
        }
        const keys = res.changes.map((c) => [c.collection, c.id] as [string, string]);
        const locals = await db.docs.bulkGet(keys);
        const toPut = [];
        for (let i = 0; i < res.changes.length; i++) {
          const c = res.changes[i];
          const local = locals[i];
          if (local && local.dirty && local.updated_at > c.updated_at) continue; // local edit is newer
          toPut.push({ c: c.collection, id: c.id, data: c.data, updated_at: c.updated_at, deleted: c.deleted ? 1 : 0, dirty: 0 } as const);
        }
        if (toPut.length) await db.docs.bulkPut(toPut as any);
      });
      since = res.rev;
      await kvSet("lastRev", since);
      first = false;
      if (!res.more) break;
    }
    set({ status: "idle", lastSync: Date.now(), error: undefined, pending: await db.docs.where("dirty").equals(1).count() });
  } catch (e) {
    const msg = (e as Error).message;
    set({ status: navigator.onLine ? "error" : "offline", error: msg, pending: await db.docs.where("dirty").equals(1).count() });
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;
export function scheduleSync(delay = 1500) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void sync(), delay);
}

export function startSyncLoop() {
  onLocalWrite(() => scheduleSync());
  window.addEventListener("online", () => void sync());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void sync();
  });
  setInterval(() => void sync(), 60_000);
  return sync();
}

export async function resetAndResync() {
  await kvSet("lastRev", 0);
  return sync();
}

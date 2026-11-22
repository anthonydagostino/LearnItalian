import { useSyncExternalStore } from "react";
import { api } from "./api";
import { db, kvGet, kvSet, onLocalWrite, type LocalDoc } from "./db";

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

interface ServerChange {
  collection: string;
  id: string;
  data: unknown;
  updated_at: number;
  deleted: boolean;
  rev: number;
}
interface SyncResponse {
  rev: number;
  more: boolean;
  reset?: boolean;
  changes: ServerChange[];
}

let running: Promise<void> | null = null;
let followUp: Promise<void> | null = null;

/**
 * Run a sync. If one is already running, the returned promise resolves after a *follow-up* run,
 * so callers that just wrote something can await sync() and know their write was included.
 */
export function sync(): Promise<void> {
  if (running) {
    followUp ??= running.then(() => {
      followUp = null;
      return sync();
    });
    return followUp;
  }
  running = doSync().finally(() => {
    running = null;
  });
  return running;
}

const pendingCount = () => db.docs.where("dirty").equals(1).count();

/** Apply server changes, never overwriting a local edit that is newer or was made after the push. */
export async function applyServerChanges(changes: ServerChange[]) {
  await db.transaction("rw", db.docs, async () => {
    const locals = await db.docs.bulkGet(changes.map((c) => [c.collection, c.id] as [string, string]));
    const toPut: LocalDoc[] = [];
    changes.forEach((c, i) => {
      const local = locals[i];
      if (local && local.dirty && local.updated_at > c.updated_at) return; // our unsynced edit is newer
      toPut.push({ c: c.collection, id: c.id, data: c.data, updated_at: c.updated_at, deleted: c.deleted ? 1 : 0, dirty: 0, base: c.updated_at });
    });
    if (toPut.length) await db.docs.bulkPut(toPut);
  });
}

async function doSync() {
  if (!navigator.onLine) {
    set({ status: "offline", pending: await pendingCount() });
    return;
  }
  set({ status: "syncing" });
  try {
    const dirty = await db.docs.where("dirty").equals(1).toArray();
    let since = await kvGet<number>("lastRev", 0);
    let first = true;
    for (let page = 0; page < 1000; page++) {
      const res = await api<SyncResponse>("/api/sync", {
        since,
        changes: first
          ? dirty.map((d) => ({ collection: d.c, id: d.id, data: d.data, updated_at: d.updated_at, deleted: !!d.deleted, base: d.base }))
          : [],
      });
      if (first) {
        // The push was received: mark docs clean unless they were written again while we were waiting.
        await db.transaction("rw", db.docs, async () => {
          for (const d of dirty) {
            const cur = await db.docs.get([d.c, d.id]);
            if (cur && cur.dirty && cur.wv === d.wv && cur.updated_at === d.updated_at) await db.docs.update([d.c, d.id], { dirty: 0 });
          }
        });
      }
      await applyServerChanges(res.changes);
      since = res.rev;
      await kvSet("lastRev", since);
      first = false;
      if (!res.more) break;
    }
    set({ status: "idle", lastSync: Date.now(), error: undefined, pending: await pendingCount() });
  } catch (e) {
    const msg = (e as Error).message;
    set({ status: navigator.onLine ? "error" : "offline", error: msg, pending: await pendingCount() });
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;
export function scheduleSync(delay = 1500) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void sync(), delay);
}

let loopStarted = false;
export function startSyncLoop() {
  if (!loopStarted) {
    loopStarted = true;
    onLocalWrite(() => scheduleSync());
    window.addEventListener("online", () => void sync());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void sync();
    });
    setInterval(() => void sync(), 60_000);
  }
  return sync();
}

/** Re-download everything (waits for any running sync first so it can't overwrite the reset). */
export async function resetAndResync() {
  if (running) await running.catch(() => {});
  await kvSet("lastRev", 0);
  return sync();
}

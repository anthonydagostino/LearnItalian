import type { FastifyInstance } from "fastify";
import { CLIENT_WRITABLE, changesSince, currentRev, putDoc, tx } from "./db.js";

interface IncomingChange {
  collection: string;
  id: string;
  data: unknown;
  updated_at: number;
  deleted?: boolean;
}

const PAGE = 4000;

export function registerSync(app: FastifyInstance) {
  app.post("/api/sync", { bodyLimit: 20 * 1024 * 1024 }, async (req) => {
    const body = (req.body ?? {}) as { since?: number; changes?: IncomingChange[] };
    const since = Number(body.since ?? 0);
    const changes = Array.isArray(body.changes) ? body.changes : [];
    let accepted = 0;
    tx(() => {
      for (const c of changes) {
        if (!CLIENT_WRITABLE.has(c.collection) || typeof c.id !== "string" || !c.id) continue;
        const updated_at = Math.min(Number(c.updated_at) || Date.now(), Date.now() + 60_000);
        if (putDoc({ collection: c.collection, id: c.id, data: c.data, updated_at, deleted: !!c.deleted }, { lww: true }))
          accepted++;
      }
    });
    const out = changesSince(since, PAGE);
    const rev = out.length ? out[out.length - 1].rev : currentRev();
    return { accepted, rev, more: out.length === PAGE, changes: out };
  });
}

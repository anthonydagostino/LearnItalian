import type { FastifyInstance } from "fastify";
import { CLIENT_WRITABLE, changesSince, currentRev, getRow, putDoc, tx } from "./db.js";

const PAGE = 4000;
const MAX_SKEW_MS = 60_000;

/**
 * Decide whether a pushed change wins over what the server has.
 * - New doc: accept.
 * - The client edited the version the server currently has (base >= server's updated_at): accept,
 *   even if the client's clock is behind. This is what keeps a slow-clock device from losing edits.
 * - Otherwise last-write-wins on timestamps; ties keep the server's version.
 * Accepted writes get an updated_at strictly greater than the previous one, so ordering stays monotonic.
 */
export function resolve(existing: { updated_at: number } | undefined, updatedAt: number, base: number | undefined) {
  if (!existing) return { accept: true, updatedAt };
  const basedOnLatest = base !== undefined && base >= existing.updated_at;
  if (basedOnLatest || updatedAt > existing.updated_at) return { accept: true, updatedAt: Math.max(updatedAt, existing.updated_at + 1) };
  return { accept: false, updatedAt: existing.updated_at };
}

export function registerSync(app: FastifyInstance) {
  app.post("/api/sync", { bodyLimit: 20 * 1024 * 1024 }, async (req, reply) => {
    const body = (req.body && typeof req.body === "object" ? req.body : {}) as { since?: unknown; changes?: unknown };
    let since = body.since === undefined ? 0 : Number(body.since);
    if (!Number.isFinite(since) || since < 0) return reply.code(400).send({ error: "Invalid 'since'" });
    // A client ahead of the server (e.g. the DB was restored from a backup) re-pulls everything.
    const reset = since > currentRev();
    if (reset) since = 0;

    const changes = Array.isArray(body.changes) ? (body.changes as unknown[]) : [];
    const now = Date.now();
    let accepted = 0;
    const rejected: { collection: string; id: string }[] = [];
    tx(() => {
      for (const raw of changes) {
        if (!raw || typeof raw !== "object") continue;
        const c = raw as Record<string, unknown>;
        if (typeof c.collection !== "string" || !CLIENT_WRITABLE.has(c.collection)) continue;
        if (typeof c.id !== "string" || !c.id || c.id.length > 300) continue;
        const ts = Number(c.updated_at);
        if (!Number.isFinite(ts) || ts <= 0) continue;
        const base = c.base === undefined || c.base === null ? undefined : Number(c.base);
        const existing = getRow(c.collection, c.id);
        const r = resolve(existing, Math.min(ts, now + MAX_SKEW_MS), Number.isFinite(base) ? base : undefined);
        if (!r.accept) {
          rejected.push({ collection: c.collection, id: c.id });
          continue;
        }
        putDoc({ collection: c.collection, id: c.id, data: c.data ?? {}, updated_at: r.updatedAt, deleted: c.deleted === true });
        accepted++;
      }
    });

    const out = changesSince(since, PAGE);
    const rev = out.length ? out[out.length - 1].rev : currentRev();
    const more = out.length === PAGE;
    // Send the server's copy of anything we rejected so the client converges instead of keeping a losing edit.
    const included = new Set(out.map((o) => `${o.collection}\u0000${o.id}`));
    for (const r of rejected) {
      if (included.has(`${r.collection}\u0000${r.id}`)) continue;
      const row = getRow(r.collection, r.id)!;
      out.push({ collection: row.collection, id: row.id, data: JSON.parse(row.data), updated_at: row.updated_at, deleted: !!row.deleted, rev: row.rev });
    }
    return { accepted, rejected: rejected.length, rev, more, reset, changes: out };
  });
}

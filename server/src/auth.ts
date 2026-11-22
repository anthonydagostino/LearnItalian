import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";

export const COOKIE = "parla_session";

const PUBLIC_ROUTES = new Set(["/api/login", "/api/health", "/api/config"]);

function hmac(value: string) {
  return crypto.createHmac("sha256", config.sessionSecret).update(value).digest();
}

/** Constant-time comparison that doesn't leak the length of the secret. */
function secretEquals(given: string, expected: string) {
  return crypto.timingSafeEqual(hmac(given), hmac(expected));
}

function token() {
  return hmac("parla:v1:" + config.appPassword).toString("hex");
}

export function isAuthed(req: FastifyRequest) {
  if (!config.appPassword) return true;
  const c = req.cookies[COOKIE];
  return typeof c === "string" && c.length > 0 && secretEquals(c, token());
}

// ---- Login rate limit: 10 failures per 15 minutes per client address ----
const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 10;
const failures = new Map<string, { count: number; first: number }>();

function limited(ip: string) {
  const f = failures.get(ip);
  if (!f) return false;
  if (Date.now() - f.first > WINDOW_MS) {
    failures.delete(ip);
    return false;
  }
  return f.count >= MAX_FAILURES;
}
function recordFailure(ip: string) {
  const f = failures.get(ip);
  if (!f || Date.now() - f.first > WINDOW_MS) failures.set(ip, { count: 1, first: Date.now() });
  else f.count++;
}

export function registerAuth(app: FastifyInstance) {
  app.post("/api/login", async (req, reply) => {
    if (limited(req.ip)) return reply.code(429).send({ error: "Too many attempts. Try again in 15 minutes." });
    const { password } = (req.body ?? {}) as { password?: unknown };
    const ok = !config.appPassword || (typeof password === "string" && password.length > 0 && secretEquals(password, config.appPassword));
    if (!ok) {
      recordFailure(req.ip);
      return reply.code(401).send({ error: "Wrong password" });
    }
    failures.delete(req.ip);
    reply.setCookie(COOKIE, token(), {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 400,
    });
    return { ok: true };
  });

  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    // Decide on the route the router actually matched, not the raw URL: the router decodes
    // percent-escapes (e.g. "/%61pi/sync" → "/api/sync"), so string checks on req.url can be bypassed.
    const route = req.routeOptions.url;
    const raw = req.url.split("?")[0].toLowerCase();
    const isApi = (route ?? "").startsWith("/api/") || raw.includes("/api/") || raw.includes("%");
    if (!isApi) return; // static assets and the SPA shell carry no data
    if (route && PUBLIC_ROUTES.has(route)) return;
    if (route === "/api/stats") {
      // Readable with the session cookie or a bearer token (for an external dashboard).
      if (isAuthed(req)) return;
      if (!config.statsToken) return; // no token configured: stats are open (they sit behind Tailscale)
      const auth = req.headers.authorization ?? "";
      if (auth.startsWith("Bearer ") && secretEquals(auth.slice(7), config.statsToken)) return;
      return reply.code(401).send({ error: "unauthorized" });
    }
    if (!isAuthed(req)) return reply.code(401).send({ error: "unauthorized" });
  });
}

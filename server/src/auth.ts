import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";

export const COOKIE = "parla_session";

function token() {
  return crypto.createHmac("sha256", config.sessionSecret).update("parla:v1:" + config.appPassword).digest("hex");
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function isAuthed(req: FastifyRequest) {
  if (!config.appPassword) return true;
  const c = req.cookies[COOKIE];
  return !!c && safeEqual(c, token());
}

export function registerAuth(app: FastifyInstance) {
  app.post("/api/login", async (req, reply) => {
    const { password } = (req.body ?? {}) as { password?: string };
    if (!config.appPassword || (password && safeEqual(password, config.appPassword))) {
      reply.setCookie(COOKIE, token(), {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 400,
      });
      return { ok: true };
    }
    return reply.code(401).send({ error: "Wrong password" });
  });

  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    const url = req.url.split("?")[0];
    if (!url.startsWith("/api/")) return; // static assets are public (no data in them)
    if (url === "/api/login" || url === "/api/health" || url === "/api/config") return;
    if (url === "/api/stats") {
      // Stats are readable with the session cookie or a bearer token (for your dashboard).
      if (isAuthed(req)) return;
      if (!config.statsToken) return; // no token configured: stats are open (they sit behind Tailscale)
      const auth = req.headers.authorization ?? "";
      if (safeEqual(auth, `Bearer ${config.statsToken}`)) return;
      return reply.code(401).send({ error: "unauthorized" });
    }
    if (!isAuthed(req)) return reply.code(401).send({ error: "unauthorized" });
  });
}

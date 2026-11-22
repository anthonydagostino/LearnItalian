import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import fs from "node:fs";
import path from "node:path";
import { registerAuth, isAuthed } from "./auth.js";
import { registerChat } from "./chat.js";
import { aiEnabled, config } from "./config.js";
import { importSeed } from "./seed.js";
import { registerStats } from "./stats.js";
import { registerStt } from "./stt.js";
import { registerSync } from "./sync.js";

export async function buildApp() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });

  registerAuth(app);
  app.get("/api/health", async () => ({ ok: true }));
  app.get("/api/config", async (req) => ({
    authed: isAuthed(req),
    passwordRequired: !!config.appPassword,
    ai: aiEnabled(),
    mockAi: config.mockAi,
    model: config.claudeModel,
    sttServer: !!config.sttUrl,
  }));
  registerSync(app);
  registerChat(app);
  registerStt(app);
  registerStats(app);
  app.post("/api/reseed", async () => importSeed());

  if (fs.existsSync(config.webDir)) {
    await app.register(fastifyStatic, {
      root: config.webDir,
      setHeaders(reply, filePath) {
        const base = path.basename(filePath);
        if (base === "sw.js" || base === "index.html" || base.endsWith(".webmanifest")) {
          reply.header("Cache-Control", "no-cache");
        }
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/") || req.method !== "GET") return reply.code(404).send({ error: "Not found" });
      return reply.sendFile("index.html");
    });
  }
  return app;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).replace(/\.ts$/, ".js").endsWith(path.join("dist", "index.js")) || process.argv[1]?.endsWith("index.ts");
if (isMain) {
  const result = importSeed();
  console.log(`Seed: ${result.files} deck files, ${result.cards} cards, ${result.changed} changed`);
  for (const w of result.warnings) console.warn("  seed warning:", w);
  const app = await buildApp();
  await app.listen({ port: config.port, host: config.host });
  if (!config.appPassword) app.log.warn("APP_PASSWORD is not set: the app is open to anyone who can reach it.");
  else if (["change-me", "changeme", "password"].includes(config.appPassword) || config.appPassword.length < 10)
    app.log.warn("APP_PASSWORD is weak or still the example value. Set a long random one in .env (see DEPLOY.md).");
  if (!aiEnabled()) app.log.warn("ANTHROPIC_API_KEY is not set: the conversation partner is disabled.");
}

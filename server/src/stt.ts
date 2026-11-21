import type { FastifyInstance } from "fastify";
import { config } from "./config.js";

/**
 * Speech-to-text proxy. The browser records audio (MediaRecorder: audio/mp4 on iOS, audio/webm elsewhere)
 * and posts it here; we forward it to an OpenAI-compatible transcription endpoint
 * (self-hosted faster-whisper via speaches, or a hosted API).
 */
export function registerStt(app: FastifyInstance) {
  app.post("/api/stt", async (req, reply) => {
    if (!config.sttUrl) return reply.code(501).send({ error: "Server speech-to-text is not configured (STT_URL)." });
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "No audio" });
    const buf = await file.toBuffer();
    if (buf.length < 1000) return { text: "" };
    const type = file.mimetype || "audio/webm";
    const ext = type.includes("mp4") || type.includes("m4a") || type.includes("aac") ? "m4a" : type.includes("ogg") ? "ogg" : type.includes("wav") ? "wav" : "webm";

    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buf)], { type }), `audio.${ext}`);
    form.append("model", config.sttModel);
    form.append("language", "it");
    form.append("response_format", "json");
    form.append("temperature", "0");

    const headers: Record<string, string> = {};
    if (config.sttApiKey) headers.Authorization = `Bearer ${config.sttApiKey}`;
    const started = Date.now();
    try {
      const res = await fetch(config.sttUrl, { method: "POST", body: form, headers, signal: AbortSignal.timeout(60_000) });
      if (!res.ok) {
        const body = await res.text();
        req.log.error({ status: res.status, body: body.slice(0, 500) }, "stt failed");
        return reply.code(502).send({ error: `Transcription failed (${res.status})` });
      }
      const json = (await res.json()) as { text?: string };
      return { text: (json.text ?? "").trim(), ms: Date.now() - started };
    } catch (e) {
      req.log.error(e, "stt error");
      return reply.code(502).send({ error: "Transcription service unreachable" });
    }
  });
}

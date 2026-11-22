import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

/** Point the server at a fresh, empty data directory. Must run before importing server modules. */
export function freshEnv(extra: Record<string, string> = {}) {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "parla-test-"));
  process.env.LOG_LEVEL = "silent";
  // Clear every variable the app reads so the host environment can't leak into tests.
  for (const k of [
    "APP_PASSWORD", "SESSION_SECRET", "STATS_TOKEN", "STT_URL", "STT_API_KEY", "STT_MODEL", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL",
    "ANTHROPIC_AUTH_TOKEN", "MOCK_AI", "SEED_DIR", "WEB_DIR", "CLAUDE_MODEL", "CLAUDE_EFFORT", "CLAUDE_SUMMARY_EFFORT",
    "CLAUDE_FALLBACKS", "CLAUDE_MAX_RETRIES",
  ]) delete process.env[k];
  Object.assign(process.env, extra);
  return process.env.DATA_DIR;
}

/** A throwaway HTTP server for faking upstream APIs. */
export async function fakeServer(handler: (req: http.IncomingMessage, body: Buffer, res: http.ServerResponse) => void) {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => handler(req, Buffer.concat(chunks), res));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
}

export function json(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

/** Build a multipart body for the STT endpoint. */
export function multipart(field: string, filename: string, type: string, data: Buffer) {
  const boundary = "----parlatest" + Math.random().toString(16).slice(2);
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { payload: Buffer.concat([head, data, tail]), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

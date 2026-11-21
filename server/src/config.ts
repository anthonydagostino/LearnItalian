import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

function env(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

export const config = {
  port: Number(env("PORT", "8080")),
  host: env("HOST", "0.0.0.0"),
  dataDir: path.resolve(env("DATA_DIR", path.join(repoRoot, "data"))),
  seedDir: path.resolve(env("SEED_DIR", path.join(repoRoot, "seed"))),
  webDir: path.resolve(env("WEB_DIR", path.join(repoRoot, "web", "dist"))),
  appPassword: env("APP_PASSWORD"),
  sessionSecret: env("SESSION_SECRET", env("APP_PASSWORD", "parla-dev-secret")),
  statsToken: env("STATS_TOKEN"),
  tz: env("TZ", "UTC"),

  // Claude
  anthropicKey: env("ANTHROPIC_API_KEY"),
  claudeModel: env("CLAUDE_MODEL", "claude-opus-5-5"),
  claudeEffort: env("CLAUDE_EFFORT", "low") as "low" | "medium" | "high" | "xhigh" | "max",
  claudeSummaryEffort: env("CLAUDE_SUMMARY_EFFORT", "medium") as "low" | "medium" | "high" | "xhigh" | "max",
  // "default" = server-side refusal fallback (recommended), "off" = disabled
  claudeFallbacks: env("CLAUDE_FALLBACKS", "default"),
  mockAi: env("MOCK_AI") === "1",

  // Speech-to-text (OpenAI-compatible /v1/audio/transcriptions endpoint: faster-whisper-server/speaches, OpenAI, Groq...)
  sttUrl: env("STT_URL"), // e.g. http://whisper:8000/v1/audio/transcriptions
  sttApiKey: env("STT_API_KEY"),
  sttModel: env("STT_MODEL", "Systran/faster-whisper-small"),
};

export function aiEnabled() {
  return config.mockAi || !!config.anthropicKey;
}

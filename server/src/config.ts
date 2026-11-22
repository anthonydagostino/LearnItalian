import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
type Effort = (typeof EFFORTS)[number];
function effort(name: string, fallback: Effort): Effort {
  const v = env(name, fallback).toLowerCase();
  if ((EFFORTS as readonly string[]).includes(v)) return v as Effort;
  console.warn(`${name}="${v}" is not one of ${EFFORTS.join(", ")}; using "${fallback}"`);
  return fallback;
}

function env(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

export const config = {
  port: Number(env("PORT", "8080")) || 8080,
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
  claudeEffort: effort("CLAUDE_EFFORT", "low"),
  claudeSummaryEffort: effort("CLAUDE_SUMMARY_EFFORT", "medium"),
  // "default" = server-side refusal fallback (recommended), "off" = disabled
  claudeFallbacks: env("CLAUDE_FALLBACKS", "default"),
  mockAi: env("MOCK_AI") === "1",
  claudeMaxRetries: Math.max(0, Math.min(Number(env("CLAUDE_MAX_RETRIES", "2")) || 0, 10)),

  // Speech-to-text (OpenAI-compatible /v1/audio/transcriptions endpoint: faster-whisper-server/speaches, OpenAI, Groq...)
  sttUrl: env("STT_URL"), // e.g. http://whisper:8000/v1/audio/transcriptions
  sttApiKey: env("STT_API_KEY"),
  sttModel: env("STT_MODEL", "Systran/faster-whisper-small"),
};

export function aiEnabled() {
  return config.mockAi || !!config.anthropicKey;
}

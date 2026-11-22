import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Each run gets a fresh database, mock AI replies, and a known password.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "parla-e2e-"));
const PORT = 8095;
// Use a preinstalled Chromium when one is provided (CI/containers); otherwise Playwright's own.
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices["iPhone 13"],
    browserName: "chromium",
    launchOptions: executablePath ? { executablePath } : {},
    trace: "off",
  },
  webServer: {
    command: "npm run build -w web && npx tsx server/src/index.ts",
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: String(PORT),
      DATA_DIR: dataDir,
      MOCK_AI: "1",
      APP_PASSWORD: "e2e-pass",
      LOG_LEVEL: "warn",
      CLAUDE_EFFORT: "low",
    },
  },
});

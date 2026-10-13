import { defineConfig, devices } from "@playwright/test";

// Live journeys against the real selfhub-api in demo mode. Run via `pnpm qa:live`
// (qa/live/run.sh seeds a fresh demo, starts the API on :8788 and the http build on :3200).
export default defineConfig({
  testDir: "./qa/live",
  outputDir: "./qa/.results-live",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // Journeys share one seeded company and change it, so they run in order.
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: process.env.QA_BASE_URL ?? "http://localhost:3200",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  },
});

import { defineConfig, devices } from "@playwright/test";

// QA journeys and screenshots. Run `pnpm build && pnpm qa` (starts `next start` on :3100).
export default defineConfig({
  testDir: "./qa/tests",
  testIgnore: ["**/live/**"],
  outputDir: "./qa/.results",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: process.env.QA_BASE_URL ?? "http://localhost:3100",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  },
  webServer: process.env.QA_BASE_URL
    ? undefined
    : { command: "pnpm start -p 3100", url: "http://localhost:3100", reuseExistingServer: true, timeout: 60_000 },
});

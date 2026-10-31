import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT || 3211);

export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: "node scripts/e2e-server.mjs",
    url: `http://localhost:${port}/login`,
    timeout: 240_000,
    reuseExistingServer: false,
    stdout: "pipe",
  },
});

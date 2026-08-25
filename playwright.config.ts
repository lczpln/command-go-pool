import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = Number(process.env.E2E_PORT ?? 8797);
const home = process.env.COMMAND_GO_POOL_HOME ?? join(tmpdir(), "cgp-e2e-home");
const dashboardReady = existsSync("apps/dashboard/dist/index.html");

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  timeout: 60_000,
  use: { baseURL: `http://127.0.0.1:${port}` },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: dashboardReady ? "npx tsx examples/demo-mock.ts" : "npm run build:dashboard && npx tsx examples/demo-mock.ts",
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      ...process.env,
      COMMAND_GO_POOL_PORT: String(port),
      COMMAND_GO_POOL_HOME: home,
      COMMAND_GO_POOL_MASTER_KEY: process.env.COMMAND_GO_POOL_MASTER_KEY ?? "e2e-master-key-not-for-production!!",
    },
  },
});

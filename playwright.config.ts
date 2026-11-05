import { defineConfig, devices } from "@playwright/test";
import { readTestEnv } from "./tests/support/test-env";

const env = readTestEnv();

export const APP_PORT = 3100;
export const PROD_GATE_PORT = 3101;

/**
 * One production build, served twice: with /dev enabled for the tests, and with
 * production defaults to prove /dev stays hidden. Hosted tests use the shared
 * project when SUPABASE_TEST_* is set, and skip with a clear reason otherwise.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 60_000,
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node scripts/e2e-servers.mjs",
    url: `http://127.0.0.1:${PROD_GATE_PORT}/api/health`,
    timeout: 240_000,
    reuseExistingServer: false,
    stdout: "pipe",
    env: {
      APP_PORT: String(APP_PORT),
      PROD_GATE_PORT: String(PROD_GATE_PORT),
      NEXT_PUBLIC_SUPABASE_URL: env?.url ?? "https://placeholder.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: env?.publishableKey ?? "placeholder",
    },
  },
});

import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const alias = {
  "@": resolve(import.meta.dirname, "src"),
  // The real package throws outside a React Server environment.
  "server-only": resolve(import.meta.dirname, "tests/support/empty-module.ts"),
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        // Fast and fully mocked. Needs no network, no secrets and no Supabase.
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.{ts,tsx}"],
          environment: "node",
        },
      },
      {
        // Talks to the shared hosted project using disposable users.
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/integration/global-setup.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});

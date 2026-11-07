import { existsSync } from "node:fs";

export type TestEnv = {
  url: string;
  publishableKey: string;
  /** Optional. Only used for cleanup and a few admin-only checks. */
  secretKey?: string;
};

/**
 * These tests read only SUPABASE_TEST_* (from the shell, then .env.test.local),
 * never .env.local, so a developer's normal setup can't run them by accident.
 * `npm run local:test` sets them in the shell for the local stack, and shell
 * values win over .env.test.local, so hosted settings can't leak into a local run. The URL and publishable
 * key are enough, so no privileged key is needed to run them.
 */
export function readTestEnv(): TestEnv | null {
  if (existsSync(".env.test.local")) process.loadEnvFile(".env.test.local");

  const url = process.env.SUPABASE_TEST_URL;
  const publishableKey = process.env.SUPABASE_TEST_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return null;
  return { url, publishableKey, secretKey: process.env.SUPABASE_TEST_SECRET_KEY || undefined };
}

export const SKIP_REASON =
  "Supabase tests skipped: SUPABASE_TEST_URL and SUPABASE_TEST_PUBLISHABLE_KEY are not set. Run them against local Supabase with npm run local:test, or see docs/supabase-setup.md for the hosted project.";

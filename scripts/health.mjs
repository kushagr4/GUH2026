#!/usr/bin/env node
// Lightweight check of the configured project, local or hosted: npm run health
import { describeSupabaseEnvProblem, isLocalUrl, loadEnvFiles } from "./lib/env.mjs";
import { runHealthChecks } from "./lib/health-checks.mjs";

loadEnvFiles(".env.local");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const problem = describeSupabaseEnvProblem(url, key);
if (problem) {
  console.error(`FAIL  Environment: ${problem}`);
  process.exit(1);
}

const local = isLocalUrl(url);
console.log(`Checking ${local ? "local" : "hosted"} Supabase at ${new URL(url).host}`);
const results = await runHealthChecks(url, key, { local });
for (const { name, ok, detail } of results) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: ${detail}`);
}
console.log(
  local
    ? "For Realtime, Studio and migrations too, run npm run local:status."
    : "Realtime is checked in the browser at /dev/realtime.",
);

if (results.some((result) => !result.ok)) process.exit(1);

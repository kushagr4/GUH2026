#!/usr/bin/env node
// Lightweight check of the shared project. Run it any time: npm run health
import { describeSupabaseEnvProblem, loadEnvFiles } from "./lib/env.mjs";
import { runHealthChecks } from "./lib/health-checks.mjs";

loadEnvFiles(".env.local");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const problem = describeSupabaseEnvProblem(url, key);
if (problem) {
  console.error(`FAIL  Environment: ${problem}`);
  process.exit(1);
}

console.log(`Checking ${new URL(url).host}`);
const results = await runHealthChecks(url, key);
for (const { name, ok, detail } of results) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: ${detail}`);
}
console.log("Realtime is checked in the browser at /dev/realtime.");

if (results.some((result) => !result.ok)) process.exit(1);

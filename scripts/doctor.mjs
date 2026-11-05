#!/usr/bin/env node
// New-machine preflight. Explains what is wrong and how to fix it: npm run doctor
import { existsSync } from "node:fs";
import { describeSupabaseEnvProblem, loadEnvFiles } from "./lib/env.mjs";
import { runHealthChecks } from "./lib/health-checks.mjs";

let failed = false;
const report = (ok, label, detail = "") => {
  if (!ok) failed = true;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `: ${detail}` : ""}`);
};

const [major, minor] = process.versions.node.split(".").map(Number);
report(
  major > 22 || (major === 22 && minor >= 12),
  "Node.js",
  `${process.versions.node} (needs 22.12 or newer; 24 is recommended)`,
);
report(
  existsSync("node_modules/next/package.json"),
  "Dependencies",
  existsSync("node_modules/next/package.json") ? "installed" : "run npm install",
);

const hasEnvFile = existsSync(".env.local");
report(hasEnvFile, ".env.local", hasEnvFile ? "found" : "run: cp .env.example .env.local");
loadEnvFiles(".env.local");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const problem = describeSupabaseEnvProblem(url, key);
report(!problem, "Supabase settings", problem ?? new URL(url).host);

for (const name of Object.keys(process.env)) {
  if (name.startsWith("NEXT_PUBLIC_") && /SECRET|SERVICE_ROLE|ANTHROPIC/.test(name)) {
    report(false, "Exposed secret", `${name} would be sent to browsers. Remove the NEXT_PUBLIC_ prefix.`);
  }
}

if (!problem) {
  for (const { name, ok, detail } of await runHealthChecks(url, key)) {
    report(ok, `Hosted ${name}`, detail);
  }
}

console.log(failed ? "\nSome checks failed. See README.md." : "\nAll good. Run: npm run dev");
if (failed) process.exit(1);

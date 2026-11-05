#!/usr/bin/env node
// After `npm run build`, proves no secret reached the browser bundle by searching
// everything Next.js serves to clients: npm run check:bundle
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadEnvFiles } from "./lib/env.mjs";

loadEnvFiles(".env.local", ".env.test.local");

const STATIC_DIR = ".next/static";
if (!existsSync(STATIC_DIR)) {
  console.error("FAIL  .next/static not found. Run npm run build first.");
  process.exit(1);
}

const FORBIDDEN = [
  { label: "a Supabase secret key", pattern: /sb_secret_[A-Za-z0-9_-]{10,}/ },
  { label: "an Anthropic key", pattern: /sk-ant-[A-Za-z0-9_-]{10,}/ },
  { label: "the SUPABASE_SECRET_KEY name", pattern: /SUPABASE_SECRET_KEY/ },
  { label: "the SUPABASE_TEST_SECRET_KEY name", pattern: /SUPABASE_TEST_SECRET_KEY/ },
  { label: "the ANTHROPIC_API_KEY name", pattern: /ANTHROPIC_API_KEY/ },
  { label: "the Anthropic SDK", pattern: /api\.anthropic\.com/ },
];

// Also search for the literal values on this machine, whatever their format.
const SECRET_VALUES = ["SUPABASE_SECRET_KEY", "SUPABASE_TEST_SECRET_KEY", "ANTHROPIC_API_KEY"]
  .map((name) => ({ name, value: process.env[name] }))
  .filter(({ value }) => value && value.length >= 8);

function* walk(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

let files = 0;
const problems = [];
for (const path of walk(STATIC_DIR)) {
  if (!/\.(js|css|html|json|map|txt)$/.test(path)) continue;
  files += 1;
  const content = readFileSync(path, "utf8");
  for (const { label, pattern } of FORBIDDEN) {
    if (pattern.test(content)) problems.push(`${path}: contains ${label}`);
  }
  for (const { name, value } of SECRET_VALUES) {
    if (content.includes(value)) problems.push(`${path}: contains the value of ${name}`);
  }
}

if (problems.length) {
  for (const problem of problems) console.error(`FAIL  ${problem}`);
  process.exit(1);
}
console.log(`PASS  ${files} client asset(s) searched, no secrets found.`);

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
  { label: "a Firecrawl key", pattern: /\bfc-[a-f0-9]{32}\b/ },
  { label: "a GitHub token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/ },
  { label: "the FIRECRAWL_API_KEY name", pattern: /FIRECRAWL_API_KEY/ },
  { label: "the GITHUB_API_TOKEN name", pattern: /GITHUB_API_TOKEN/ },
  { label: "the GITHUB_WEBHOOK_SECRET name", pattern: /GITHUB_WEBHOOK_SECRET/ },
  { label: "the Firecrawl client", pattern: /api\.firecrawl\.dev/ },
  { label: "an ElevenLabs key", pattern: /\bsk_[a-f0-9]{48}\b/ },
  { label: "the ELEVENLABS_API_KEY name", pattern: /ELEVENLABS_API_KEY/ },
  { label: "the ElevenLabs client", pattern: /api\.elevenlabs\.io/ },
  { label: "the N8N_WEBHOOK_SECRET name", pattern: /N8N_WEBHOOK_SECRET/ },
  { label: "the N8N_CALLBACK_SECRET name", pattern: /N8N_CALLBACK_SECRET/ },
];

// Also search for the literal values on this machine, whatever their format.
const SECRET_VALUES = [
  "SUPABASE_SECRET_KEY",
  "SUPABASE_TEST_SECRET_KEY",
  "ANTHROPIC_API_KEY",
  "FIRECRAWL_API_KEY",
  "GITHUB_API_TOKEN",
  "GITHUB_WEBHOOK_SECRET",
  "ELEVENLABS_API_KEY",
  "N8N_WEBHOOK_SECRET",
  "N8N_CALLBACK_SECRET",
]
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

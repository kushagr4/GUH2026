#!/usr/bin/env node
// Scans tracked and untracked (non-ignored) files, plus all of Git history, for
// credentials. Dependency-free so it works on every machine: npm run secrets:scan
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const SECRET_PATTERNS = [
  { name: "Supabase secret key", pattern: /sb_secret_[A-Za-z0-9_-]{10,}/ },
  { name: "Supabase access token", pattern: /\bsbp_[a-f0-9]{20,}/ },
  { name: "JWT (legacy Supabase key or session)", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: "Anthropic API key", pattern: /\bsk-ant-[A-Za-z0-9_-]{10,}/ },
  { name: "GitHub token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/ },
  { name: "Firecrawl API key", pattern: /\bfc-[a-f0-9]{32}\b/ },
  // ElevenLabs doesn't document its key format; this is the long-standing sk_ + 48 hex shape.
  { name: "ElevenLabs API key", pattern: /\bsk_[a-f0-9]{48}\b/ },
  { name: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Private key", pattern: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/ },
  { name: "Database URL with password", pattern: /\bpostgres(?:ql)?:\/\/[^:\s/]+:(?!\[|<|password|your)[^@\s]{3,}@/ },
];

/** Files that may legitimately be committed, and generated files not worth scanning. */
const SKIP_FILES = new Set(["package-lock.json"]);

export function findSecrets(text) {
  return SECRET_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ name }) => name);
}

function git(...args) {
  const result = spawnSync("git", args, { encoding: "utf8", maxBuffer: 1024 * 1024 * 512 });
  if (result.status !== 0) return null;
  return result.stdout;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const findings = [];

  const files = (git("ls-files", "-co", "--exclude-standard") ?? "")
    .split("\n")
    .filter(Boolean);

  for (const file of files) {
    if (/(^|\/)\.env/.test(file) && !file.endsWith(".env.example")) {
      findings.push(`${file}: env file would be committed`);
    }
    if (SKIP_FILES.has(file)) continue;
    let content;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const name of findSecrets(content)) findings.push(`${file}: ${name}`);
  }

  let commits = 0;
  const hasCommits = git("rev-parse", "--verify", "HEAD") !== null;
  if (hasCommits) {
    commits = Number((git("rev-list", "--all", "--count") ?? "0").trim());
    const history = git("log", "--all", "-p", "--no-color", "--format=commit %H", "--", ".", ":(exclude)package-lock.json") ?? "";
    let commit = "";
    const seen = new Set();
    for (const line of history.split("\n")) {
      if (line.startsWith("commit ")) {
        commit = line.slice(7, 15);
      } else if (line.startsWith("+")) {
        for (const name of findSecrets(line)) {
          const entry = `history ${commit}: ${name}`;
          if (!seen.has(entry)) {
            seen.add(entry);
            findings.push(entry);
          }
        }
      }
    }
  }

  // Only names and locations are printed, so the scan never echoes a secret.
  if (findings.length) {
    for (const finding of findings) console.error(`FAIL  ${finding}`);
    console.error(`\n${findings.length} possible secret(s). Remove them and rotate anything real.`);
    process.exit(1);
  }
  console.log(`PASS  ${files.length} file(s) and ${commits} commit(s) scanned, no secrets found.`);
}

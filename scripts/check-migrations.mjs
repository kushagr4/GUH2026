#!/usr/bin/env node
// Static security and safety lint for SQL migrations. Needs no database, so it runs
// on every machine and in CI: npm run db:lint
//
// A rule can be waived per file, with a reason, by adding a comment such as:
//   -- migration-allow: destructive dropping the unused demo table
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const FILE_NAME = /^\d{14}_[a-z0-9_]+\.sql$/;

const RULES = [
  {
    allow: "destructive",
    message:
      "Destructive statement. This database is shared, so make changes additive (docs/team-workflow.md).",
    patterns: [
      /\bdrop\s+(table|schema|column|type|view|materialized\s+view|function|trigger|index|policy)\b/i,
      /\balter\s+table\b[^;]*\bdrop\b/i,
      /\balter\s+table\b[^;]*\brename\b/i,
      /\btruncate\b/i,
      /\bdelete\s+from\b/i,
    ],
  },
  {
    allow: "security-definer",
    message: "SECURITY DEFINER bypasses RLS. Use security invoker instead.",
    patterns: [/\bsecurity\s+definer\b/i],
  },
  {
    allow: "public-access",
    message: "This grants access to anonymous or all users. Scope it to authenticated.",
    patterns: [
      /\bgrant\b[^;]*?\bto\s+(?:\w+\s*,\s*)*(?:anon|public)\b/i,
      /\bcreate\s+policy\b[^;]*?\bto\s+(?:\w+\s*,\s*)*(?:anon|public)\b/i,
      /\busing\s*\(\s*true\s*\)/i,
      /\bwith\s+check\s*\(\s*true\s*\)/i,
    ],
  },
  {
    allow: "public-bucket",
    message: "Storage buckets must be private.",
    patterns: [/\binsert\s+into\s+storage\.buckets\b[^;]*\btrue\b/i],
  },
];

function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/** Waivers that give a reason. A bare `-- migration-allow: x` does not count. */
function readWaivers(sql) {
  const waivers = new Set();
  for (const match of sql.matchAll(/--\s*migration-allow:\s*([a-z-]+)[ \t]+\S+/g)) {
    waivers.add(match[1]);
  }
  return waivers;
}

export function lintMigration(fileName, rawSql) {
  const issues = [];

  if (!FILE_NAME.test(fileName)) {
    issues.push("File name must be <14-digit timestamp>_<lower_snake_name>.sql. Use npm run db:new.");
  }
  if (rawSql.includes("TODO(template)")) {
    issues.push("The template TODO is still here. Finish or delete this migration.");
  }

  const waivers = readWaivers(rawSql);
  const sql = stripComments(rawSql);

  for (const rule of RULES) {
    if (waivers.has(rule.allow)) continue;
    if (rule.patterns.some((pattern) => pattern.test(sql))) {
      issues.push(`${rule.message} (waive with: -- migration-allow: ${rule.allow} <reason>)`);
    }
  }

  for (const statement of sql.matchAll(/\binsert\s+into\s+storage\.buckets\b[^;]*/gi)) {
    if (!/\bfile_size_limit\b/i.test(statement[0])) {
      issues.push("Storage buckets must set file_size_limit, to protect the free-plan quota.");
    }
  }

  const tables = sql.matchAll(
    /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?(?:(\w+)\.)?(\w+)/gi,
  );
  for (const [, schema, table] of tables) {
    if (!schema) {
      issues.push(`Table "${table}" must be schema-qualified, for example public.${table}.`);
      continue;
    }
    if (schema.toLowerCase() !== "public") continue;

    const name = `public\\.${table}\\b`;
    if (!new RegExp(`alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?${name}\\s+enable\\s+row\\s+level\\s+security`, "i").test(sql)) {
      issues.push(`public.${table} must enable row level security in this migration.`);
    }
    if (!new RegExp(`\\bgrant\\b[^;]*\\bon\\s+(?:table\\s+)?${name}[^;]*\\bto\\b`, "i").test(sql)) {
      issues.push(`public.${table} needs explicit GRANTs, because new tables get no Data API access by default.`);
    }
    if (!new RegExp(`\\bcreate\\s+policy\\b[^;]*\\bon\\s+${name}`, "i").test(sql)) {
      issues.push(`public.${table} needs at least one RLS policy in this migration.`);
    }
  }

  return issues;
}

export function lintDirectory(directory) {
  const files = readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const results = new Map();

  const seen = new Set();
  for (const file of files) {
    const issues = lintMigration(file, readFileSync(join(directory, file), "utf8"));
    const stamp = file.split("_")[0];
    if (seen.has(stamp)) {
      issues.push(`Timestamp ${stamp} is used twice. Rename this file with a new timestamp.`);
    }
    seen.add(stamp);
    results.set(file, issues);
  }
  return results;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const results = lintDirectory("supabase/migrations");
  let problems = 0;
  for (const [file, issues] of results) {
    for (const issue of issues) {
      problems += 1;
      console.error(`FAIL  ${file}: ${issue}`);
    }
  }
  if (problems) {
    console.error(`\n${problems} problem(s) in ${results.size} migration(s).`);
    process.exit(1);
  }
  console.log(`PASS  ${results.size} migration(s) checked.`);
}

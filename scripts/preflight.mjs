#!/usr/bin/env node
// Runs what CI's "PR Checks" job runs, in the same order, then prints a summary.
// Like CI it carries on after a failure, so one run shows everything to fix.
//
//   npm run preflight                       everything, including the E2E smoke tests
//   npm run preflight -- --no-e2e           skip the browser tests (no Chromium needed)
//   npm run preflight -- --title "feat(x): y"   also check the PR title you plan to use
//
// Needs no Supabase credentials and spends nothing. Run before marking a PR ready.
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const skipE2e = argv.includes("--no-e2e");
const titleIndex = argv.indexOf("--title");
const title = titleIndex >= 0 ? argv[titleIndex + 1] : undefined;

const checks = [
  // Passed as arguments, not through a shell, so any title text is safe.
  ...(title !== undefined
    ? [{ name: "PR title", file: process.execPath, args: ["scripts/check-commits.mjs", "--title", title] }]
    : []),
  { name: "Commit messages (advisory)", command: "node scripts/check-commits.mjs --branch --advisory" },
  { name: "Workflow files", command: "npm run check:workflows" },
  { name: "ESLint", command: "npm run lint" },
  { name: "TypeScript", command: "npm run typecheck" },
  { name: "Unit tests", command: "npm test" },
  { name: "Migration lint", command: "npm run db:lint" },
  { name: "Secret scan", command: "npm run secrets:scan" },
  { name: "Production build", command: "npm run build", id: "build" },
  { name: "Client bundle scan", command: "npm run check:bundle", needs: "build" },
  // Only the smoke spec: like CI, the preflight never touches the shared project.
  { name: "E2E smoke tests", command: "npx playwright test e2e/smoke.spec.ts", needs: "build", e2e: true },
];

const results = [];
const passed = new Set();
for (const check of checks) {
  if (check.e2e && skipE2e) {
    results.push({ name: check.name, outcome: "skipped (--no-e2e)" });
    continue;
  }
  if (check.needs && !passed.has(check.needs)) {
    results.push({ name: check.name, outcome: "skipped (the build failed)" });
    continue;
  }
  console.log(`\n=== ${check.name}: ${check.command ?? `node ${check.args.join(" ")}`}`);
  const started = Date.now();
  const run = check.file
    ? spawnSync(check.file, check.args, { stdio: "inherit" })
    : spawnSync(check.command, { shell: true, stdio: "inherit" });
  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  const ok = run.status === 0;
  if (ok && check.id) passed.add(check.id);
  results.push({ name: check.name, outcome: ok ? `pass (${seconds}s)` : `FAIL (${seconds}s)`, failed: !ok });
}

console.log("\n=== Preflight summary");
const width = Math.max(...results.map((result) => result.name.length));
for (const result of results) console.log(`  ${result.name.padEnd(width)}  ${result.outcome}`);

const failures = results.filter((result) => result.failed);
const skipped = results.filter((result) => result.outcome.startsWith("skipped"));
if (failures.length) {
  console.log(`\n${failures.length} check(s) failed. Scroll up to the matching "===" heading for the details.`);
  process.exit(1);
}
console.log(
  skipped.length
    ? `\nEverything that ran passed, but ${skipped.length} check(s) were skipped, so this isn't a full preflight.`
    : "\nAll checks passed. This is what CI's PR Checks job runs.",
);

#!/usr/bin/env node
// Records that /self-review passed for this branch's committed diff, which lets
// the git guard allow `gh pr ready`. Only the /self-review skill runs this, after
// no Critical or Important finding is left. Writing the marker any other way
// defeats the point.
//
//   node .claude/hooks/review-mark.mjs "<one line: what was reviewed and fixed>"
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { branchDiff, git, markerPath, repoRoot } from "./lib.mjs";

const note = process.argv.slice(2).join(" ").trim();
const root = repoRoot(process.cwd());
if (!root) {
  console.error("review-mark: not inside a git repository.");
  process.exit(1);
}

// The marker covers commits only, because that's what a PR contains.
const dirty = git(["status", "--porcelain", "--untracked-files=no"], root);
if (dirty.out) {
  console.error("review-mark: there are uncommitted changes. Commit them, review the result, then mark it.");
  process.exit(1);
}

const diff = branchDiff(root);
if (diff.error) {
  console.error(`review-mark: ${diff.error}`);
  process.exit(1);
}
if (diff.empty) {
  console.error("review-mark: this branch has no changes against origin/main, so there's nothing to mark.");
  process.exit(1);
}

const file = markerPath(root);
mkdirSync(dirname(file), { recursive: true });
const marker = {
  diff_hash: diff.hash,
  head: diff.head,
  branch: diff.branch,
  base: diff.base,
  reviewed_at: new Date().toISOString(),
  note,
};
writeFileSync(file, `${JSON.stringify(marker, null, 2)}\n`);
console.log(`Self-review recorded for ${diff.branch} at ${diff.head.slice(0, 7)} (diff ${diff.hash.slice(0, 12)}).`);
console.log("Next: push, then `gh pr ready`, and request a human reviewer.");

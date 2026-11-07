// Shared by git-guard.mjs and review-mark.mjs. Node only, no dependencies.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

export const BASE_REF = "origin/main";

export function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 1024 * 1024 * 256 });
  return { ok: result.status === 0, out: (result.stdout ?? "").trim(), raw: result.stdout ?? "" };
}

export function repoRoot(cwd) {
  const root = git(["rev-parse", "--show-toplevel"], cwd);
  return root.ok ? root.out : null;
}

export function markerPath(root) {
  return join(root, ".claude", "review", "last-review.json");
}

/**
 * Hashes what a pull request from this branch contains: the committed diff
 * against where the branch left origin/main. Uncommitted work isn't in a PR, so
 * it isn't in the hash, and committing or rebasing without changing the diff
 * keeps the hash the same.
 */
export function branchDiff(cwd) {
  const base = git(["merge-base", BASE_REF, "HEAD"], cwd);
  if (!base.ok || !base.out) {
    return { error: `can't find where this branch left ${BASE_REF}. Run \`git fetch origin main\` first.` };
  }
  const diff = git(["diff", "--binary", base.out, "HEAD"], cwd);
  if (!diff.ok) return { error: "`git diff` failed, so the branch diff can't be hashed." };
  return {
    base: base.out,
    head: git(["rev-parse", "HEAD"], cwd).out,
    branch: git(["branch", "--show-current"], cwd).out,
    hash: createHash("sha256").update(diff.raw).digest("hex"),
    empty: diff.raw.length === 0,
  };
}

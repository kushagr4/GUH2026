import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluate, pushTargetsMain, stripQuoted } from "../../.claude/hooks/git-guard.mjs";

const HOOK = resolve(".claude/hooks/git-guard.mjs");
const context = (branch = "feat/example") => ({ currentBranch: () => branch });
const decision = (cmd: string, branch?: string) => evaluate(cmd, context(branch)).decision;

describe("git guard: hackathon fast-build mode", () => {
  it.each([
    "gh pr merge 12 --squash",
    "gh -R kushagr4/GUH2026 pr merge 3",
    "gh pr review 12 --approve",
    "gh api -X PUT repos/kushagr4/GUH2026/pulls/12/merge",
    "SKIP_GIT_GUARD=1 gh pr merge 3",
  ])("keeps merges/approvals human-controlled: %s", (cmd) => {
    expect(decision(cmd)).toBe("deny");
  });

  it.each([
    "gh pr create --fill",
    "gh pr create --draft --fill",
    "gh pr ready",
    "gh pr ready 12",
    "gh pr view 12",
    "gh pr checks 12",
    "git status",
    "git push -u origin HEAD",
  ])("allows normal PR work with no self-review marker: %s", (cmd) => {
    expect(decision(cmd)).toBe("allow");
  });

  it.each(["git push origin main", "git push origin HEAD:main", "git push --all"])(
    "denies pushing to main: %s",
    (cmd) => expect(decision(cmd)).toBe("deny"),
  );
  it("denies an implicit push on main", () => {
    expect(decision("git push", "main")).toBe("deny");
  });
  it("allows a push on a feature branch", () => {
    expect(decision("git push", "feat/example")).toBe("allow");
  });
  it("checks refspecs, not option values", () => {
    expect(pushTargetsMain(["-o", "main", "origin", "feat/example"], () => "feat/example")).toBe(false);
  });
  it("ignores quoted command references", () => {
    expect(stripQuoted('echo "gh pr merge"')).toBe('echo ""');
  });
  it("hook still denies merge requests", () => {
    const p = spawnSync(process.execPath, [HOOK], {
      encoding: "utf8",
      input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "gh pr merge 2" } }),
    });
    expect(p.status).toBe(0);
    expect(JSON.parse(p.stdout).hookSpecificOutput.permissionDecision).toBe("deny");
  });
  it("hook allows PR creation with no output", () => {
    const p = spawnSync(process.execPath, [HOOK], {
      encoding: "utf8",
      input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "gh pr create --fill" } }),
    });
    expect(p.status).toBe(0);
    expect(p.stdout).toBe("");
  });
});

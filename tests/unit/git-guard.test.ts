import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluate, gitContext, pushTargetsMain, stripQuoted } from "../../.claude/hooks/git-guard.mjs";

const HOOK = resolve(".claude/hooks/git-guard.mjs");
const MARK = resolve(".claude/hooks/review-mark.mjs");

function context(branch = "chore/x", reviewed = false) {
  return {
    currentBranch: () => branch,
    reviewState: () => (reviewed ? { ok: true } : { ok: false, reason: "Not reviewed." }),
  };
}
const decision = (command: string, ctx = context()) => evaluate(command, ctx).decision;

describe("git guard: merging and approving are always a person's job", () => {
  it.each([
    "gh pr merge 12 --squash",
    "gh pr merge",
    "gh -R kushagr4/GUH2026 pr merge 3",
    "gh.exe pr merge 3",
    "cd repo && gh pr merge 3",
    "git status; gh pr merge 3",
    "Set-Location D:\\repo; if ($?) { gh pr merge 3 }",
    "& gh pr merge 3",
    "gh pr review 12 --approve",
    "gh pr review --approve -b 'looks good'",
    "gh pr review 12 -a",
    "gh api -X PUT repos/kushagr4/GUH2026/pulls/12/merge",
    "gh api repos/kushagr4/GUH2026/pulls/12/reviews -f event=APPROVE",
    "gh api graphql -f query='mutation { mergePullRequest(input: {}) { clientMutationId } }'",
    "SKIP_GIT_GUARD=1 gh pr merge 3",
    `gh pr comment 1 -b 'he said "ok' && gh pr merge 1 && echo "done"`,
    `echo "it's fine" && gh pr merge 1 && echo 'ok'`,
  ])("denies %s", (command) => {
    expect(decision(command, context("chore/x", true))).toBe("deny");
  });

  it.each([
    'git commit -m "docs: explain why we never run gh pr merge"',
    "git commit -F - <<'EOF'\ndocs: workflow\n\ngh pr merge 3\nEOF",
    "git commit -m @'\ndocs: workflow\n\ngh pr merge 3\n'@",
    "echo don't merge; git status",
    "gh pr view 12 --json mergeStateStatus",
    "gh pr review 12 --comment -b 'one thought'",
    "gh pr review 12 --request-changes -b 'see inline'",
    "gh api repos/kushagr4/GUH2026/pulls/12 --jq .mergeable",
  ])("allows %s", (command) => {
    expect(decision(command)).toBe("allow");
  });
});

describe("git guard: main only changes through a PR", () => {
  it.each([
    ["git push origin main", "chore/x"],
    ["git push origin HEAD:main", "chore/x"],
    ["git push origin chore/x:main", "chore/x"],
    ["git push -f origin +main", "chore/x"],
    ["git push origin refs/heads/main", "chore/x"],
    ["git push --delete origin main", "chore/x"],
    ["git push --all", "chore/x"],
    ["git push", "main"],
    ["git push -u origin HEAD", "main"],
    ["git -C D:/repo push origin main", "chore/x"],
  ])("denies %s on %s", (command, branch) => {
    expect(decision(command, context(branch))).toBe("deny");
  });

  it.each([
    ["git push", "chore/x"],
    ["git push -u origin chore/x", "chore/x"],
    ["git push -u origin HEAD", "feat/12-sign-in"],
    ["git push origin main-fixes", "chore/x"],
    ["git push --delete origin chore/old", "chore/x"],
    ["git pull origin main", "chore/x"],
    ["git merge origin/main", "chore/x"],
    ["SKIP_GIT_GUARD=1 git push origin main", "chore/x"],
    ["$env:SKIP_GIT_GUARD=1; git push origin main", "chore/x"],
  ])("allows %s on %s", (command, branch) => {
    expect(decision(command, context(branch))).toBe("allow");
  });

  it("only honours the skip token at the start of the first line", () => {
    const command = 'git commit -m "x\nSKIP_GIT_GUARD=1 y"\ngit push origin main';
    expect(decision(command)).toBe("deny");
  });

  it("reads refspecs, not option values", () => {
    expect(pushTargetsMain(["-o", "main", "origin", "chore/x"], () => "chore/x")).toBe(false);
  });
});

describe("git guard: ready for review only after /self-review", () => {
  it.each(["gh pr ready", "gh pr ready 12", "gh pr create --fill", "gh pr create -t 'feat: x' -b body"])(
    "denies %s before a review",
    (command) => {
      const result = evaluate(command, context());
      expect(result.decision).toBe("deny");
      expect(result).toMatchObject({ reason: expect.stringMatching(/\/self-review/) });
    },
  );

  it.each(["gh pr create --draft --fill", "gh pr create -d --fill", "gh pr ready 12 --undo", "gh pr edit 12 --add-reviewer d3vmakes"])(
    "allows %s before a review",
    (command) => {
      expect(decision(command)).toBe("allow");
    },
  );

  it("allows marking ready once the diff has passed review", () => {
    expect(decision("gh pr ready 12", context("chore/x", true))).toBe("allow");
  });
});

describe("stripQuoted", () => {
  it("treats quoted text, here-strings and heredocs as data", () => {
    expect(stripQuoted(`echo "gh pr merge" 'gh pr merge'`)).toBe(`echo "" ''`);
    expect(stripQuoted("cat <<EOF\ngh pr merge\nEOF\nls")).toBe("cat <<HEREDOC\nls");
  });
});

describe("git guard hook protocol", () => {
  const run = (payload: object) =>
    spawnSync(process.execPath, [HOOK], { input: JSON.stringify(payload), encoding: "utf8" });

  it("prints a PreToolUse deny decision and exits 0", () => {
    const result = run({ tool_name: "Bash", tool_input: { command: "gh pr merge 1" } });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" },
    });
  });

  it("checks PowerShell commands too", () => {
    const result = run({ tool_name: "PowerShell", tool_input: { command: "gh pr merge 1" } });
    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("prints nothing for an allowed command or another tool", () => {
    expect(run({ tool_name: "Bash", tool_input: { command: "git status" } }).stdout).toBe("");
    expect(run({ tool_name: "Read", tool_input: { file_path: "gh pr merge" } }).stdout).toBe("");
  });

  it("fails open, loudly, on input it can't read", () => {
    const result = spawnSync(process.execPath, [HOOK], { input: "not json", encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).systemMessage).toMatch(/INACTIVE/);
  });
});

describe("the review marker, end to end in a throwaway repository", () => {
  let repo: string;
  let emptyConfig: string;
  const sh = (args: string[]) => {
    const result = spawnSync("git", args, {
      cwd: repo,
      encoding: "utf8",
      env: {
        ...process.env,
        // Ignore the developer's own git config (signing, global hooks, templates).
        GIT_CONFIG_GLOBAL: emptyConfig,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_AUTHOR_NAME: "Test",
        GIT_AUTHOR_EMAIL: "test@example.com",
        GIT_COMMITTER_NAME: "Test",
        GIT_COMMITTER_EMAIL: "test@example.com",
      },
    });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
  };
  const mark = () => spawnSync(process.execPath, [MARK, "test review"], { cwd: repo, encoding: "utf8" });
  const commit = (file: string, text: string) => {
    writeFileSync(join(repo, file), text);
    sh(["add", file]);
    sh(["commit", "-q", "-m", `chore: ${file}`]);
  };

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "guh-guard-"));
    emptyConfig = join(mkdtempSync(join(tmpdir(), "guh-gitconfig-")), "config");
    writeFileSync(emptyConfig, "");
    sh(["init", "-q", "-b", "main"]);
    commit("a.txt", "one\n");
    sh(["update-ref", "refs/remotes/origin/main", "HEAD"]);
    sh(["switch", "-q", "-c", "chore/test"]);
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it("refuses to mark a branch with no changes", () => {
    expect(mark().status).toBe(1);
  });

  it("gates ready until the marker matches, and again after a new commit", () => {
    commit("b.txt", "two\n");
    const guard = gitContext(repo);
    expect(guard.reviewState({ forReady: false })).toMatchObject({ ok: false });

    const result = mark();
    expect(result.status, result.stderr).toBe(0);
    expect(guard.reviewState({ forReady: false })).toEqual({ ok: true });

    commit("c.txt", "three\n");
    expect(guard.reviewState({ forReady: false })).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/changed after the last \/self-review/),
    });
  });

  it("refuses to mark uncommitted work", () => {
    writeFileSync(join(repo, "b.txt"), "edited\n");
    expect(mark().stderr).toMatch(/uncommitted changes/);
    sh(["checkout", "--", "b.txt"]);
  });
});

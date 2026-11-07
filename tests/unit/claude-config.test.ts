import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

/** Reads the YAML frontmatter Claude Code uses to discover skills and agents. */
function frontmatter(file: string): Record<string, unknown> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(readFileSync(file, "utf8"));
  expect(match, `${file} has no frontmatter`).not.toBeNull();
  return parse(match![1]) as Record<string, unknown>;
}

describe("Claude Code skills and agents are discoverable", () => {
  const skills = readdirSync(".claude/skills");

  it("ships the feature, bugfix and self-review skills", () => {
    expect(skills).toEqual(expect.arrayContaining(["feature-dev", "bugfix", "self-review"]));
  });

  it.each(skills)("skill %s has a matching name and a description", (skill) => {
    const meta = frontmatter(`.claude/skills/${skill}/SKILL.md`);
    expect(meta.name).toBe(skill);
    expect(String(meta.description ?? "").trim().length).toBeGreaterThan(0);
  });

  it("keeps self-review explicit-request-only during the hackathon fast build", () => {
    const meta = frontmatter(".claude/skills/self-review/SKILL.md");
    expect(String(meta.description)).not.toMatch(/Triggers on/);
    expect(String(meta.description)).toMatch(/explicit/i);
  });

  it.each(["code-explorer", "code-architect", "code-reviewer"])("agent %s is read-only", (agent) => {
    const meta = frontmatter(`.claude/agents/${agent}.md`);
    expect(meta.name).toBe(agent);
    expect(meta.description).toBeTruthy();
    expect(String(meta.tools).split(/,\s*/)).toEqual(["Glob", "Grep", "Read"]);
  });

  it("CLAUDE.md points Claude at the skills", () => {
    const claude = readFileSync("CLAUDE.md", "utf8");
    for (const skill of ["/feature-dev", "/bugfix", "/self-review"]) expect(claude).toContain(skill);
  });
});

describe("the git guard is registered", () => {
  const settings = JSON.parse(readFileSync(".claude/settings.json", "utf8"));

  it("runs before every Bash and PowerShell command", () => {
    const entry = settings.hooks.PreToolUse.find((hook: { matcher: string }) => hook.matcher === "Bash|PowerShell");
    expect(entry.hooks[0].command).toContain(".claude/hooks/git-guard.mjs");
    expect(existsSync(".claude/hooks/git-guard.mjs")).toBe(true);
  });

  it("also denies gh pr merge by permission, in case the hook can't run", () => {
    expect(settings.permissions.deny).toEqual(expect.arrayContaining(["Bash(gh pr merge*)", "PowerShell(gh pr merge*)"]));
  });

  it("keeps the review marker out of Git", () => {
    expect(readFileSync(".gitignore", "utf8")).toContain(".claude/review/");
  });
});

describe("the ready-made ruleset for main", () => {
  const ruleset = JSON.parse(readFileSync(".github/rulesets/protect-main.json", "utf8"));
  const rule = (type: string) => ruleset.rules.find((entry: { type: string }) => entry.type === type);

  it("targets main, is active, and has no bypass", () => {
    expect(ruleset.target).toBe("branch");
    expect(ruleset.enforcement).toBe("active");
    expect(ruleset.bypass_actors).toEqual([]);
    expect(ruleset.conditions.ref_name.include).toEqual(["refs/heads/main"]);
  });

  it("requires a squash-merged PR and PR Checks, with no mandatory approval (hackathon fast build)", () => {
    expect(rule("pull_request").parameters).toMatchObject({
      required_approving_review_count: 0,
      allowed_merge_methods: ["squash"],
    });
    expect(rule("required_status_checks").parameters.required_status_checks).toEqual([
      { context: "PR Checks", integration_id: 15368 },
    ]);
  });

  it("blocks force pushes and deletion", () => {
    expect(rule("non_fast_forward")).toBeTruthy();
    expect(rule("deletion")).toBeTruthy();
  });

  it("requires the same check name the CI job reports", () => {
    expect(readFileSync(".github/workflows/ci.yml", "utf8")).toContain("name: PR Checks");
  });
});

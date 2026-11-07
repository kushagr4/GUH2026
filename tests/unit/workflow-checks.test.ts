import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { checkHeader } from "../../scripts/check-commits.mjs";
import { checkWorkflow, workflowFiles } from "../../scripts/check-workflows.mjs";

const SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1";

describe("checkHeader (Conventional Commits)", () => {
  it.each([
    "feat(auth): add social sign-in",
    "fix(realtime): wait for authenticated subscription",
    "test(storage): verify access restrictions",
    "chore: bump dependencies",
    "feat(api)!: drop the v1 route",
    "docs(sign-in/oauth): explain the callback",
    "fix(ui): README link points at the right page",
    'Revert "feat(auth): add social sign-in"',
  ])("accepts %s", (header) => {
    expect(checkHeader(header)).toEqual([]);
  });

  it.each([
    ["no type", "Add social sign-in", /type\(scope\): description/],
    ["an unknown type", "feature(auth): add sign-in", /isn't a known type/],
    ["an uppercase type", "Feat(auth): add sign-in", /lowercase: "feat"/],
    ["an uppercase scope", "feat(Auth): add sign-in", /scope "Auth"/],
    ["a sentence-case description", "feat(auth): Add sign-in", /start the description in lowercase/],
    ["a full stop", "fix: handle an empty list.", /full stop/],
    ["an empty description", "fix: ", /add a description/],
    ["a missing space", "fix:handle it", /space after the colon/],
    ["an empty title", "   ", /empty/],
  ])("rejects %s", (_label, header, message) => {
    expect(checkHeader(header).join(" ")).toMatch(message);
  });

  it("rejects a header over 100 characters", () => {
    expect(checkHeader(`feat: ${"a".repeat(100)}`).join(" ")).toMatch(/keep it to 100/);
  });

  it("checks only the first line of a full commit message", () => {
    expect(checkHeader("fix: handle an empty list\n\nLonger body. Capitalised.")).toEqual([]);
  });
});

const workflow = (body: string) => `name: Test\non:\n  push:\npermissions:\n  contents: read\n${body}`;

describe("checkWorkflow", () => {
  it("accepts a well-formed workflow", () => {
    const text = workflow(
      `jobs:\n  a:\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    steps:\n      - uses: actions/checkout@${SHA} # v7\n      - run: echo hi\n`,
    );
    expect(checkWorkflow(text)).toEqual([]);
  });

  it("reports a YAML syntax error with its line", () => {
    const problems = checkWorkflow("name: Test\non: [push\njobs: {}\n");
    expect(problems[0]).toMatch(/^line \d+:/);
  });

  it.each([
    ["an action pinned to a tag", `      - uses: actions/checkout@v7\n`, /Pin actions to a full commit SHA/],
    ["a step with nothing to do", `      - name: nothing\n`, /needs "uses:" or "run:"/],
  ])("rejects %s", (_label, step, message) => {
    const text = workflow(`jobs:\n  a:\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    steps:\n${step}`);
    expect(checkWorkflow(text).join(" ")).toMatch(message);
  });

  it("requires a timeout, a runner and permissions", () => {
    const text = "on: push\njobs:\n  a:\n    steps:\n      - run: echo hi\n";
    const problems = checkWorkflow(text).join(" ");
    expect(problems).toMatch(/timeout-minutes/);
    expect(problems).toMatch(/runs-on/);
    expect(problems).toMatch(/permissions/);
  });

  it("refuses pull_request_target, which runs PR code with secrets", () => {
    const text = `on:\n  pull_request_target:\npermissions: {}\njobs:\n  a:\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    steps:\n      - run: echo hi\n`;
    expect(checkWorkflow(text).join(" ")).toMatch(/pull_request_target/);
  });

  it("passes every workflow in this repo", () => {
    for (const file of workflowFiles()) {
      expect(checkWorkflow(readFileSync(file, "utf8")), file).toEqual([]);
    }
  });
});

type Step = { name?: string; run?: string; if?: string; env?: Record<string, string> };
type Job = { name: string; if?: string; env?: Record<string, string>; steps: Step[] };

describe("the CI workflow", () => {
  const ci = parse(readFileSync(".github/workflows/ci.yml", "utf8")) as {
    on: Record<string, { types?: string[]; branches?: string[] }>;
    permissions: Record<string, string>;
    jobs: Record<string, Job>;
  };
  const prChecks = ci.jobs["pr-checks"];
  const hosted = ci.jobs.hosted;

  it("has one PR Checks job, triggered on PRs to main, pushes to main and by hand", () => {
    expect(prChecks.name).toBe("PR Checks");
    expect(ci.on.pull_request.branches).toEqual(["main"]);
    expect(ci.on.pull_request.types).toEqual(["opened", "synchronize", "reopened", "edited"]);
    expect(ci.on.push.branches).toEqual(["main"]);
    expect(ci.on).toHaveProperty("workflow_dispatch");
    expect(ci.permissions).toEqual({ contents: "read" });
  });

  it("runs every required check in the PR job", () => {
    const commands = prChecks.steps.map((step) => step.run ?? "").join("\n");
    for (const command of [
      "npm ci",
      "check-commits.mjs --title",
      "check-commits.mjs --range",
      "npm run check:workflows",
      "npm run lint",
      "npm run typecheck",
      "npm test",
      "npm run db:lint",
      "npm run secrets:scan",
      "npm run build",
      "npm run check:bundle",
      "npm run test:e2e",
    ]) {
      expect(commands, command).toContain(command);
    }
    expect(commands.match(/npm ci/g)).toHaveLength(1);
  });

  it("keeps running checks after one fails, so one run reports every failure", () => {
    const checks = prChecks.steps.slice(3);
    for (const step of checks) expect(step.if, step.name).toMatch(/^\$\{\{ !cancelled\(\) && /);
  });

  it("never passes secrets to the PR job or interpolates PR text into a script", () => {
    const text = JSON.stringify(prChecks);
    expect(text).not.toMatch(/secrets\./);
    for (const step of prChecks.steps) expect(step.run ?? "", step.name).not.toMatch(/\$\{\{/);
  });

  it("keeps the hosted tests opt-in and off pull requests", () => {
    expect(hosted.if).toContain("github.event_name == 'workflow_dispatch' && inputs.hosted");
    expect(hosted.if).toContain("vars.RUN_HOSTED_TESTS == 'true'");
    expect(hosted.if).not.toContain("pull_request");
    expect(JSON.stringify(hosted)).toContain("secrets.SUPABASE_TEST_URL");
  });

  it("never deploys", () => {
    expect(readFileSync(".github/workflows/ci.yml", "utf8")).not.toMatch(/deploy|vercel/i);
  });
});


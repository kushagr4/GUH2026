import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Local development runs on the Supabase CLI's own container stack
 * (scripts/local-supabase.mjs). These checks keep the two worlds apart: local
 * commands can never reach the hosted project, hosted commands never need a
 * container, and nothing can wipe data without an explicit opt-in.
 */
const LOCAL = readFileSync("scripts/local-supabase.mjs", "utf8");
const HOSTED = readFileSync("scripts/db.mjs", "utf8");
const { scripts } = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>;
};

describe("local and hosted workflows stay separate", () => {
  it("local commands never target a remote project", () => {
    expect(LOCAL).not.toMatch(/["']--remote|["']--linked|["']--db-url/);
    for (const [name, command] of Object.entries(scripts)) {
      if (name.startsWith("local:")) expect(command, name).not.toMatch(/--remote|--linked|--db-url/);
    }
  });

  it("local commands never delete the data volume", () => {
    expect(LOCAL).not.toMatch(/["']--no-backup/);
  });

  it("a local reset needs an explicit flag", () => {
    expect(LOCAL).toMatch(/if \(!args\.includes\(RESET_FLAG\)\)/);
    expect(scripts["local:reset"]).not.toMatch(/yes-delete-local-data/);
  });

  it("local status output, which holds privileged keys, is never inherited by the terminal", () => {
    expect(LOCAL).not.toMatch(/cliSync\(\[\s*"(start|status)"[^)]*capture:\s*false/);
    expect(LOCAL).toMatch(/cliWithHeartbeat\(\["start"\]/);
  });

  it("the hosted wrapper never needs a container and never resets", () => {
    expect(HOSTED).not.toMatch(/\bdocker\b|["'](start|stop)["']/i);
    expect(HOSTED).not.toMatch(/["']reset["']/);
    expect(HOSTED).not.toMatch(/--include-seed/);
  });

  it("no package script calls a container runtime directly", () => {
    for (const [name, command] of Object.entries(scripts)) {
      expect(command, name).not.toMatch(/\bdocker(-compose)?\b|\bpodman\b/);
    }
  });

  it("no CI workflow or Claude Code hook needs a container runtime", () => {
    const files = [".github/workflows", ".claude/hooks"]
      .filter((directory) => existsSync(directory))
      .flatMap((directory) => readdirSync(directory).map((name) => join(directory, name)));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/\bdocker\b|\bpodman\b|supabase\s+(start|stop|db\s+reset)/i);
    }
  });
});

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Team requirement: nothing in the normal workflow may need a container runtime. */
const FORBIDDEN = /\bdocker\b|\bpodman\b|supabase\s+(start|stop|status)\b|supabase\s+db\s+reset\b|supabase\s+db\s+(diff|pull|dump)\b/i;

function scriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? scriptFiles(join(directory, entry.name))
      : [join(directory, entry.name)],
  );
}

describe("Docker-free workflow", () => {
  it("package.json scripts never call a container runtime or local stack", () => {
    const { scripts } = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    for (const [name, command] of Object.entries(scripts)) {
      expect(command, name).not.toMatch(FORBIDDEN);
    }
  });

  it("helper scripts never call a container runtime or local stack", () => {
    for (const file of scriptFiles("scripts")) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(FORBIDDEN);
    }
  });

  it("the CI workflow does not depend on one", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(workflow).not.toMatch(FORBIDDEN);
  });

  it("no script resets the shared database", () => {
    const db = readFileSync("scripts/db.mjs", "utf8");
    expect(db).not.toMatch(/["']reset["']/);
    expect(db).not.toMatch(/--include-seed/);
  });
});

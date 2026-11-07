import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * EmberGap develops against the hosted Supabase project and deploys to Vercel,
 * so nothing may need Docker or a local Supabase stack, and nothing may be able
 * to reset or wipe the shared database.
 */
const HOSTED = readFileSync("scripts/db.mjs", "utf8");
const { scripts } = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>;
};
/** Invocations, not prose: a spawned container CLI, or a command that needs a local stack. */
const CONTAINERS =
  /["'](docker|docker-compose|podman)["']|\b(docker|docker-compose|podman)\s+(run|start|stop|info|compose|ps|exec|up|down|volume|system)\b|supabase\s+(start|stop|status)\b|supabase\s+db\s+reset\b/i;

function files(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)],
  );
}

describe("no container runtime or local Supabase stack", () => {
  it("has the standard commands and no local stack commands", () => {
    for (const name of ["dev", "build", "start", "lint", "typecheck", "test"]) {
      expect(scripts[name], name).toBeTruthy();
    }
    expect(Object.keys(scripts).filter((name) => name.startsWith("local:"))).toEqual([]);
    expect(existsSync("scripts/local-supabase.mjs")).toBe(false);
  });

  it("recognises the invocations it guards against", () => {
    for (const command of ['spawnSync("docker", ["info"])', "docker compose up", "npx supabase start", "supabase db reset"]) {
      expect(command).toMatch(CONTAINERS);
    }
    expect("the old local Docker stack").not.toMatch(CONTAINERS);
  });

  it("no package script calls a container runtime or local stack", () => {
    for (const [name, command] of Object.entries(scripts)) {
      expect(command, name).not.toMatch(CONTAINERS);
    }
  });

  it("no helper script, CI workflow or Claude Code hook needs one", () => {
    const checked = [...files("scripts"), ...files(".github/workflows"), ...files(".claude/hooks")];
    expect(checked.length).toBeGreaterThan(0);
    for (const file of checked) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(CONTAINERS);
    }
  });
});

describe("the shared hosted database stays safe", () => {
  it("the hosted wrapper is owner-only, pushes with --remote, and never resets", () => {
    expect(HOSTED).toContain("requireMigrationOwner()");
    expect(HOSTED).toContain('["db", "push", "--remote"]');
    expect(HOSTED).not.toMatch(/["']reset["']/);
    expect(HOSTED).not.toMatch(/--include-seed/);
  });

  it("no script can reset or wipe a database", () => {
    for (const file of files("scripts")) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/db\s+reset|["']--no-backup|drop\s+(table|schema|database)/i);
    }
  });

  it("no secret is given a NEXT_PUBLIC_ name in .env.example", () => {
    const names = readFileSync(".env.example", "utf8").match(/^#?\s*NEXT_PUBLIC_[A-Z_]+/gm) ?? [];
    for (const name of names) expect(name, name).not.toMatch(/SECRET|SERVICE_ROLE|ANTHROPIC|FIRMS|KEY_PRIVATE/);
    expect(readFileSync(".env.example", "utf8")).toMatch(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=/);
  });
});

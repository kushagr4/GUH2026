import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Docker is now required for local development, but CI and hosted deployment
 * must remain Docker-independent, and remote resets must never be possible.
 */
describe("local Docker / remote CI separation", () => {
  it("provides local Docker-backed scripts without modifying hosted commands", () => {
    const { scripts } = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(scripts["local:dev"]).toContain("local-supabase.mjs dev");
    expect(scripts["local:up"]).toContain("local-supabase.mjs up");
    expect(scripts["local:reset"]).toContain("local-supabase.mjs reset");
    expect(scripts["db:push"]).toContain("db.mjs push");
  });

  it("normal CI needs no Docker, containers, or remote credentials", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(workflow).not.toMatch(/docker\s+(run|compose|build)|supabase\s+start|local:dev|local:up/i);
  });

  it("the local helper requires explicit opt-in for destructive local reset", () => {
    const helper = readFileSync("scripts/local-supabase.mjs", "utf8");
    expect(helper).toContain('process.env.GUH_ALLOW_LOCAL_RESET !== "true"');
    expect(helper).toContain('["db", "reset", "--local"]');
    expect(helper).not.toContain('"--remote"');
  });

  it("remote migration commands retain safeguards against resetting the cloud", () => {
    const db = readFileSync("scripts/db.mjs", "utf8");
    expect(db).not.toMatch(/["']reset["']/);
    expect(db).not.toMatch(/--include-seed/);
    expect(db).toContain("requireMigrationOwner()");
    expect(db).toContain('["db", "push", "--remote"]');
  });
});

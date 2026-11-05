#!/usr/bin/env node
// Safe wrappers around the Supabase CLI for the shared hosted project. No command
// here needs a container runtime, and none can reset or wipe the database.
//
//   npm run db:new -- add_notes    Create a migration from the secure template
//   npm run db:status              Compare local files with the hosted history
//   npm run db:plan                Dry run: show what would be applied
//   npm run db:push                Apply pending migrations (migration owner only)
//   npm run db:types               Regenerate TypeScript types from the hosted schema
//   npm run db:audit               Read-only security audit
//   npm run env:share              Print the two public values to give teammates
//   npm run env:test               Write .env.test.local for the hosted tests
//   npm run db:sweep-tests         Remove old disposable test accounts (owner only)
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { lintDirectory } from "./check-migrations.mjs";

const CLI = "node_modules/supabase/dist/supabase.js";
const TYPES_FILE = "src/lib/supabase/database.types.ts";
const OWNER_FILE = "supabase/MIGRATION_OWNER";
const PROJECT_REF_FILE = "supabase/.temp/project-ref";

const [command, ...args] = process.argv.slice(2);

function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

function supabase(cliArgs, options = {}) {
  return spawnSync(process.execPath, [CLI, ...cliArgs], {
    encoding: "utf8",
    stdio: options.capture ? ["inherit", "pipe", "pipe"] : "inherit",
    maxBuffer: 1024 * 1024 * 64,
  });
}

function git(...gitArgs) {
  const result = spawnSync("git", gitArgs, { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function requireLink() {
  if (!existsSync(PROJECT_REF_FILE)) {
    fail(
      "This checkout is not linked to the shared project yet.\n" +
        "Migration owner only: npx supabase login, then npx supabase link <project-ref>.\n" +
        "Everyone else: you do not need this command. See docs/team-workflow.md.",
    );
  }
}

/** A guard rail. The real control is that only the owner holds Supabase access. */
function requireMigrationOwner() {
  const owners = readFileSync(OWNER_FILE, "utf8")
    .split("\n")
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line && !line.startsWith("#"));
  const me = (git("config", "user.name") ?? "").toLowerCase();
  if (!owners.includes(me)) {
    fail(
      `Only the designated migration owner (${owners.join(", ")}) deploys to the shared database.\n` +
        "Open a pull request with your migration and they will apply it. See docs/team-workflow.md.",
    );
  }
}

function requireCleanMigrations() {
  let problems = 0;
  for (const [file, issues] of lintDirectory("supabase/migrations")) {
    for (const issue of issues) {
      problems += 1;
      console.error(`FAIL  ${file}: ${issue}`);
    }
  }
  if (problems) fail("Fix the migration problems above before deploying.");
}

/** Only reviewed code that is already on main reaches the shared database. */
function requireMergedToMain() {
  if (git("rev-parse", "--abbrev-ref", "HEAD") !== "main") {
    fail("Deploy from main, after the pull request has merged.");
  }
  if (git("status", "--porcelain", "--", "supabase/migrations")) {
    fail("supabase/migrations has uncommitted changes. Commit them through a pull request first.");
  }
  git("fetch", "origin", "main");
  const head = git("rev-parse", "HEAD");
  const remote = git("rev-parse", "origin/main");
  if (head !== remote) {
    fail("Your main does not match origin/main. Run git pull, or push your commits, first.");
  }
}

function exitWith(result) {
  process.exit(result.status ?? 1);
}

/**
 * Output from `projects api-keys` must never reach a terminal or log: it includes
 * the legacy service_role key in full, even without --reveal. Always capture it.
 */
function readApiKeys({ reveal = false } = {}) {
  const result = supabase(
    ["projects", "api-keys", "--remote", "--output", "json", ...(reveal ? ["--reveal"] : [])],
    { capture: true },
  );
  if (result.status !== 0) fail("Could not read the project's API keys. Are you signed in?");
  const parsed = JSON.parse(result.stdout.slice(result.stdout.search(/[[{]/)));
  return Array.isArray(parsed) ? parsed : (parsed.keys ?? parsed.data ?? []);
}

function generateTypes() {
  const result = supabase(["gen", "types", "typescript", "--remote", "--schema", "public"], {
    capture: true,
  });
  if (result.status !== 0) fail(`Type generation failed:\n${result.stderr}`);
  if (!result.stdout.includes("export type Database")) {
    fail("Type generation returned unexpected output, so the types file was not changed.");
  }
  return result.stdout;
}

const TEMPLATE = (name) => `-- ${name}
-- TODO(template): write this migration, then delete this line.
--
-- Rules for the shared database (docs/team-workflow.md):
--   Additive only: no drops or renames while teammates may depend on the object.
--   Every public table needs explicit grants, RLS and policies in this same file.
--
-- create table public.example (
--   id uuid primary key default gen_random_uuid(),
--   owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
--   title text not null check (char_length(title) <= 200),
--   created_at timestamptz not null default now()
-- );
--
-- create index example_owner_idx on public.example (owner_id);
--
-- revoke all on table public.example from anon, public;
-- grant select, insert, update, delete on table public.example to authenticated;
-- grant select, insert, update, delete on table public.example to service_role;
--
-- alter table public.example enable row level security;
--
-- create policy "example: owner can read" on public.example for select to authenticated
--   using ((select auth.uid()) = owner_id);
-- create policy "example: owner can insert" on public.example for insert to authenticated
--   with check ((select auth.uid()) = owner_id);
-- create policy "example: owner can update" on public.example for update to authenticated
--   using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
-- create policy "example: owner can delete" on public.example for delete to authenticated
--   using ((select auth.uid()) = owner_id);
--
-- Only if the UI needs live updates:
-- alter publication supabase_realtime add table public.example;
`;

switch (command) {
  case "new": {
    const name = (args[0] ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    if (!name) fail("Give the migration a name: npm run db:new -- add_notes");
    const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    const path = `supabase/migrations/${stamp}_${name}.sql`;
    writeFileSync(path, TEMPLATE(name));
    console.log(`Created ${path}`);
    break;
  }

  case "status":
    requireLink();
    exitWith(supabase(["migration", "list", "--remote"]));
    break;

  case "plan":
    requireLink();
    requireCleanMigrations();
    exitWith(supabase(["db", "push", "--remote", "--dry-run"]));
    break;

  case "push": {
    requireMigrationOwner();
    requireLink();
    requireCleanMigrations();
    if (!args.includes("--skip-git-checks")) requireMergedToMain();
    const cliArgs = ["db", "push", "--remote"];
    // The CLI asks for confirmation unless the owner passes --yes on purpose.
    if (args.includes("--yes")) cliArgs.push("--yes");
    const result = supabase(cliArgs);
    if (result.status === 0) {
      console.log("\nFinished. If migrations were applied, run npm run db:types and commit the result.");
    }
    exitWith(result);
    break;
  }

  case "types": {
    requireLink();
    const generated = generateTypes();
    if (args.includes("--check")) {
      const current = existsSync(TYPES_FILE) ? readFileSync(TYPES_FILE, "utf8") : "";
      if (current !== generated) {
        fail(`${TYPES_FILE} does not match the hosted schema. Run npm run db:types.`);
      }
      console.log("PASS  Database types match the hosted schema.");
    } else {
      writeFileSync(TYPES_FILE, generated);
      console.log(`Updated ${TYPES_FILE}`);
    }
    break;
  }

  case "audit": {
    requireLink();
    const query = supabase(
      ["db", "query", "--remote", "--read-only", "--file", "supabase/audits/rls_audit.sql"],
      { capture: true },
    );
    if (query.status !== 0) fail(`The audit query failed:\n${query.stderr}`);
    console.log("RLS audit (any rows listed are problems):");
    console.log(query.stdout.trim());
    console.log("\nSupabase security advisors:");
    exitWith(supabase(["db", "advisors", "--remote", "--type", "security"]));
    break;
  }

  case "env-share": {
    // Safe to run in a shared terminal: it only ever prints the two public values.
    requireLink();
    const publishable = readApiKeys().find((key) => key.type === "publishable")?.api_key;
    if (!publishable) fail("No publishable key found. Create one in the dashboard.");
    const ref = readFileSync(PROJECT_REF_FILE, "utf8").trim();
    console.log(`NEXT_PUBLIC_SUPABASE_URL=https://${ref}.supabase.co`);
    console.log(`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${publishable}`);
    break;
  }

  case "env-test": {
    // Hosted tests only need the public values. --with-secret adds the secret key,
    // which enables automatic cleanup and a few admin-only checks.
    requireLink();
    const withSecret = args.includes("--with-secret");
    if (withSecret) requireMigrationOwner();
    const list = readApiKeys({ reveal: withSecret });
    const publishable = list.find((key) => key.type === "publishable")?.api_key;
    if (!publishable) fail("No publishable key found. Create one in the dashboard.");
    const secret = withSecret
      ? list.find((key) => key.type === "secret")?.api_key
      : undefined;
    if (withSecret && !secret) fail("No secret key found. Create one in the dashboard.");

    const ref = readFileSync(PROJECT_REF_FILE, "utf8").trim();
    writeFileSync(
      ".env.test.local",
      `# Written by npm run env:test. Gitignored. Do not share.\n` +
        `SUPABASE_TEST_URL=https://${ref}.supabase.co\n` +
        `SUPABASE_TEST_PUBLISHABLE_KEY=${publishable}\n` +
        (secret ? `SUPABASE_TEST_SECRET_KEY=${secret}\n` : ""),
    );
    // Values are deliberately not printed.
    console.log(`Wrote .env.test.local (${secret ? "with" : "without"} the secret key)`);
    break;
  }

  case "sweep-tests": {
    // Removes only disposable accounts that match the tests' exact email pattern
    // and are more than 30 minutes old. Real accounts can't match.
    requireMigrationOwner();
    requireLink();
    exitWith(
      supabase([
        "db", "query", "--remote", "--yes",
        "delete from auth.users where email ~ '^guh-test\\+[0-9a-f-]{36}@example\\.test$' " +
          "and created_at < now() - interval '30 minutes' returning 'removed' as result;",
      ]),
    );
    break;
  }

  default:
    fail(
      "Unknown command. Use one of: new, status, plan, push, types, audit, env-share, env-test, sweep-tests.",
    );
}

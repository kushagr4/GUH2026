import { describe, expect, it } from "vitest";
import { lintDirectory, lintMigration } from "../../scripts/check-migrations.mjs";

const NAME = "20261107120000_add_notes.sql";

const GOOD_TABLE = `
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
);
revoke all on table public.notes from anon, public;
grant select, insert on table public.notes to authenticated;
alter table public.notes enable row level security;
create policy "notes: owner can read" on public.notes for select to authenticated
  using ((select auth.uid()) = owner_id);
`;

describe("lintMigration", () => {
  it("accepts a secure additive table", () => {
    expect(lintMigration(NAME, GOOD_TABLE)).toEqual([]);
  });

  it.each([
    ["no RLS", GOOD_TABLE.replace(/alter table.*row level security;/, ""), /row level security/],
    ["no grants", GOOD_TABLE.replace(/grant select.*authenticated;/, ""), /explicit GRANTs/],
    ["no policy", GOOD_TABLE.replace(/create policy[\s\S]*$/, ""), /at least one RLS policy/],
    ["no schema", "create table notes (id int);", /schema-qualified/],
  ])("flags a table with %s", (_label, sql, expected) => {
    expect(lintMigration(NAME, sql).join("\n")).toMatch(expected);
  });

  it.each([
    ["drop table public.notes;"],
    ["alter table public.notes drop column body;"],
    ["alter table public.notes rename to things;"],
    ["alter table public.notes rename column a to b;"],
    ["truncate public.notes;"],
    ["delete from public.notes;"],
    ["drop schema public cascade;"],
  ])("blocks destructive SQL: %s", (sql) => {
    expect(lintMigration(NAME, sql).join("\n")).toContain("Destructive");
  });

  it("allows a destructive change only when a reason is given", () => {
    const sql = "drop table public.notes;";
    expect(
      lintMigration(NAME, `-- migration-allow: destructive removing the unused demo\n${sql}`),
    ).toEqual([]);
    expect(lintMigration(NAME, `-- migration-allow: destructive\n${sql}`)).not.toEqual([]);
  });

  it("blocks SECURITY DEFINER", () => {
    const sql = "create function public.f() returns void language sql security definer as $$ select 1 $$;";
    expect(lintMigration(NAME, sql).join("\n")).toContain("SECURITY DEFINER");
  });

  it.each([
    ["grant select on table public.notes to anon;"],
    ["grant select on table public.notes to authenticated, anon;"],
    ["grant select on table public.notes to public;"],
    ['create policy "x" on public.notes for select to anon using (owner_id is null);'],
    ['create policy "x" on public.notes for select to authenticated using (true);'],
    ['create policy "x" on public.notes for insert to authenticated with check (true);'],
  ])("blocks public access: %s", (sql) => {
    expect(lintMigration(NAME, sql).join("\n")).toContain("public-access");
  });

  it("does not mistake a schema reference for a public grant", () => {
    const sql = `grant usage on schema public to authenticated;
      create policy "x" on public.notes for select to authenticated
      using (public.is_member(owner_id));`;
    expect(lintMigration(NAME, sql)).toEqual([]);
  });

  it("allows revoking from public", () => {
    expect(lintMigration(NAME, "revoke all on table public.notes from anon, public;")).toEqual([]);
  });

  it("blocks public buckets and buckets with no size limit", () => {
    const publicBucket =
      "insert into storage.buckets (id, name, public, file_size_limit) values ('a','a',true,100);";
    expect(lintMigration(NAME, publicBucket).join("\n")).toContain("must be private");

    const noLimit = "insert into storage.buckets (id, name, public) values ('a','a',false);";
    expect(lintMigration(NAME, noLimit).join("\n")).toContain("file_size_limit");
  });

  it("ignores commented-out SQL", () => {
    expect(lintMigration(NAME, "-- drop table public.notes;\n/* truncate x; */")).toEqual([]);
  });

  it("rejects a badly named file", () => {
    expect(lintMigration("add_notes.sql", "select 1;").join("\n")).toContain("File name");
  });

  it("rejects an unfinished template", () => {
    expect(lintMigration(NAME, "-- TODO(template): write this").join("\n")).toContain(
      "template",
    );
  });
});

describe("the migrations in this repo", () => {
  it("all pass the lint", () => {
    const results = lintDirectory("supabase/migrations");
    expect(results.size).toBeGreaterThan(0);
    for (const [file, issues] of results) {
      expect(issues, file).toEqual([]);
    }
  });
});

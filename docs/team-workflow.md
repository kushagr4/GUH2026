# Team workflow

Each teammate has their own local Supabase in Docker (see [docker-development.md](docker-development.md)), built from `supabase/migrations/`. Code and migrations are shared through Git. Data isn't. The hosted free-plan project is for the deployed demo, and only the migration owner changes its schema.

## Frontend and app changes

Everyone has their own branch, dev server, local Supabase and `.env.local`, so this work can't disturb anyone else.

Every change goes through an owned feature branch and a normal PR with automated **PR Checks** but **no mandatory Claude self-review or teammate approval**. The steps are in [development-workflow.md](development-workflow.md). Keep `main` demoable at all times.

## Migration ownership

**One designated developer deploys migrations to the shared hosted project.** Every teammate may apply version-controlled migrations locally. The name is in `supabase/MIGRATION_OWNER`.

| | Anyone | Migration owner |
| --- | --- | --- |
| Write a migration file in a PR | Yes | Yes |
| `npm run db:lint` | Yes | Yes |
| Validate locally and lint migrations | Yes | Required before hosted push |
| `npm run db:push` | No | Yes |
| Hold the Supabase login and secret key | No | Yes |

`npm run db:push` refuses to run for anyone else, and off `main`. That script is a guard rail. The real control is that only the owner has Supabase credentials.

To hand over, change `supabase/MIGRATION_OWNER` in a PR, invite the new owner to the Supabase organisation, and have them run the first three steps of [supabase-setup.md](supabase-setup.md).

`supabase/MIGRATION_OWNER` identifies the one person authorised to apply hosted migrations. The owner checks schema readiness using local migration/lint tests, not a required PR approval.

## Changing the schema

1. **Create the file:** `npm run db:new -- add_things`
2. **Write it.** The template includes the required grants, RLS and policies.
3. **Try it locally:** `npm run local:migrate`, then `npm run local:types`. Check it in the app, in Studio (<http://127.0.0.1:54323>) and with `npm run local:test`.
4. **Check it:** `npm run db:lint`
5. **Open a normal PR** containing the additive migration, generated local types and the code that needs it. No mandatory reviewer pass.
6. **Run schema verification:** `npm run db:lint`, `npm run local:migrate` and relevant local RLS tests. The human repo owner merges after checking necessary CI results. No teammate approval is required.
7. **The owner applies it to the hosted project** from an up-to-date `main`, then checks that the hosted types match. `db:push` refuses to run anywhere else:

```bash
git switch main
```

```bash
git pull
```

```bash
npm run db:plan
```

```bash
npm run db:push
```

```bash
npm run db:types -- --check
```

   The check compares the schema, not formatting, so types generated locally pass, and usually nothing more is needed. If it fails, the hosted schema differs from the migrations.
8. **If the types check failed, the owner opens a normal PR with regenerated types**, rather than pushing directly to `main`:

```bash
npm run db:types
```

```bash
git switch -c chore/db-types
```

```bash
git commit -am "chore(db): update generated types"
```

```bash
git push -u origin HEAD
```

```bash
gh pr create --fill
```

   The human repository owner merges when ready. No review gate.
9. **Teammates pull.** Their next `npm run local:dev` applies the new migration to their own database.

### Keeping your code working until the migration lands

Locally, your table is live as soon as you run `npm run local:migrate`, so you're never blocked. The hosted demo gets it only after the owner applies it. Until then, the deployed app shows a clear error rather than crashing, and `/dev` shows what's missing.

### Rules that prevent conflicts

- **Additive only.** Add tables and nullable columns. Don't drop or rename anything a teammate might use. `db:lint` blocks destructive SQL unless a reason is given.
- **One owner per table.** Agree who is changing which table.
- **Prefix by feature** when two people work in parallel, for example `poll_votes` and `poll_options`.
- **Never edit a migration that has been applied.** Write a new one.
- **Never change the schema in Studio, the dashboard or through MCP** without a matching migration file. Otherwise your teammates' databases, the hosted project and the types drift apart.

### If two migrations collide

Supabase applies files in timestamp order and rejects a file older than one already applied. If yours was overtaken, rename it with a new timestamp and push the change. Don't use `--include-all` on the hosted database. Locally, `npm run local:migrate -- --include-all` is fine for catching up after a pull.

If two people add the same table, the second one to merge rewrites theirs as an `alter table`.

### Undoing a mistake

There's no reset on the hosted database. Write a new forward migration that corrects the mistake, and include a `-- migration-allow: destructive <reason>` line if it has to remove something. Locally, you may rebuild your own database from the files with `npm run local:reset -- --yes-delete-local-data`, which deletes your local data.

## Essential migration checks (not an approval gate)

- Does every new public table have `enable row level security`, explicit grants and policies?
- Are policies `to authenticated` and owner-scoped, with nothing granted to `anon`?
- Is anything destructive? If so, is it really safe, and is everyone aware?
- If it uses Realtime, does the UI really need live updates?
- Do any new buckets stay private with limits?

## Secrets

- For local development, teammates need no shared values. `npm run local:dev` writes the local URL and publishable key itself, and nothing else.
- `.env.local` and `.env.test.local` are gitignored. Never commit them.
- Share values through a private channel the team trusts. Never put the secret key anywhere shared.
- CI needs no secrets. Hosted CI is opt-in and uses GitHub Actions secrets.

## Onboarding a new teammate

Send them the [README quick start](../README.md#quick-start) and this page. No shared keys are needed for local development. They should be running in under 5 minutes. `npm run doctor` tells them what's wrong if not.

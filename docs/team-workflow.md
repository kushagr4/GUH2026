# Team workflow

Everyone develops against the team's one hosted Supabase project ([supabase-cloud-development.md](supabase-cloud-development.md)); there is no Docker or local database. Code and migrations are shared through Git, and the database is shared too, so row-level security keeps each user's rows private. Only the migration owner changes the schema.

## Frontend and app changes

Everyone has their own branch, dev server, `.env.local` and accounts, so frontend work can't disturb anyone else. Data you create is visible only to you (and reviewers); use disposable accounts for experiments, and never change another person's data.

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

`supabase/MIGRATION_OWNER` identifies the one person authorised to apply hosted migrations. The owner checks schema readiness with `npm run db:lint`, `npm run db:plan` and the hosted integration tests, not a required PR approval.

## Changing the schema

1. **Create the file:** `npm run db:new -- add_things`
2. **Write it.** The template includes the required grants, RLS and policies.
3. **Check it:** `npm run db:lint`. Add RLS cases to `tests/integration/` that use disposable users.
4. **Open a normal PR** containing the additive migration and the code that needs it. Until it's applied, the code should fail gracefully (`/dev` shows what's missing). No mandatory reviewer pass.
5. **The human repo owner merges** after checking the CI results. No teammate approval is required.
6. **The owner applies it to the hosted project** from an up-to-date `main`, then checks that the hosted types match. `db:push` refuses to run anywhere else:

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

   The check compares the schema, not formatting, so usually nothing more is needed. If it fails, the committed types differ from the hosted schema.
7. **If the types check failed, the owner opens a normal PR with regenerated types**, rather than pushing directly to `main`:

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
8. **Teammates pull.** The schema is already live for everyone, because there is one database.

### Keeping your code working until the migration lands

Your table exists for everyone only after the owner applies it. Until then, keep building against fixtures (the EmberGap contracts include `SYNTHETIC_SCENARIOS`), and make the feature show a clear error rather than crash. `/dev` shows what's missing.

### Rules that prevent conflicts

- **Additive only.** Add tables and nullable columns. Don't drop or rename anything a teammate might use. `db:lint` blocks destructive SQL unless a reason is given.
- **One owner per table.** Agree who is changing which table.
- **Prefix by feature** when two people work in parallel, for example `poll_votes` and `poll_options`.
- **Never edit a migration that has been applied.** Write a new one.
- **Never change the schema in Studio, the dashboard or through MCP** without a matching migration file. Otherwise the migration history, the hosted project and the types drift apart.

### If two migrations collide

Supabase applies files in timestamp order and rejects a file older than one already applied. If yours was overtaken, rename it with a new timestamp and push the change. Don't use `--include-all` on the hosted database.

If two people add the same table, the second one to merge rewrites theirs as an `alter table`.

### Undoing a mistake

There's no reset on the hosted database. Write a new forward migration that corrects the mistake, and include a `-- migration-allow: destructive <reason>` line if it has to remove something.

## Essential migration checks (not an approval gate)

- Does every new public table have `enable row level security`, explicit grants and policies?
- Are policies `to authenticated` and owner-scoped, with nothing granted to `anon`?
- Is anything destructive? If so, is it really safe, and is everyone aware?
- If it uses Realtime, does the UI really need live updates?
- Do any new buckets stay private with limits?

## Secrets

- Teammates need only the two public values (the project URL and publishable key), from the dashboard or `npm run env:share`. The secret key is never shared: it lives only in Vercel and on the migration owner's machine.
- `.env.local` and `.env.test.local` are gitignored. Never commit them.
- Share values through a private channel the team trusts. Never put the secret key anywhere shared.
- CI needs no secrets. Hosted CI is opt-in and uses GitHub Actions secrets.

## Onboarding a new teammate

Send them the [README quick start](../README.md#quick-start), this page and [supabase-cloud-development.md](supabase-cloud-development.md), plus the two public values. They should be running in under 5 minutes. `npm run doctor` tells them what's wrong if not.

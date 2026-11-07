# Team workflow

Each teammate now has an independent Docker-backed local database. SQL migrations are shared through Git, while the hosted project remains reserved for demo/deployment.

## Frontend and app changes

Everyone has their own branch, dev server, independent local Supabase and automatically generated `.env.local`.

1. `git switch -c feature/short-name`
2. Build it, and commit small.
3. Run `npm run validate` before opening a PR if you changed anything risky.
4. Open a PR. CI runs lint, types, tests, the migration lint, the secret scan, the build and the smoke tests.
5. Merge quickly. Keep `main` demoable at all times.

## Migration ownership

**One designated developer deploys migrations to the shared hosted project.** Every teammate may apply reviewed migrations locally. The name is in `supabase/MIGRATION_OWNER`.

| | Anyone | Migration owner |
| --- | --- | --- |
| Write a migration file in a PR | Yes | Yes |
| `npm run db:lint` | Yes | Yes |
| Review migration PRs | Yes | Required |
| `npm run db:push` | No | Yes |
| Hold the Supabase login and secret key | No | Yes |

`npm run db:push` refuses to run for anyone else, and off `main`. That script is a guard rail. The real control is that only the owner has Supabase credentials.

To hand over, change `supabase/MIGRATION_OWNER` in a PR, invite the new owner to the Supabase organisation, and have them run the first three steps of [supabase-setup.md](supabase-setup.md).

`.github/CODEOWNERS` requests the owner's review for `supabase/`. GitHub doesn't enforce required reviews on private repos on the free plan, so treat that as a team rule.

## Changing the schema

1. **Create the file:** `npm run db:new -- add_things`
2. **Write it.** The template includes the required grants, RLS and policies.
3. **Check it:** `npm run db:lint`
4. **Open a PR** containing only that migration and the code that needs it.
5. **The owner reviews and merges,** then applies it and commits the new types:

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
npm run db:types
```

6. **The owner pushes the types** to `main`, and teammates pull.

### Keeping your code working until the migration lands

Your branch may need a table that isn't live yet. The app shows a clear error rather than crashing, and `/dev` shows what's missing. If you're blocked, ask the owner to apply your reviewed migration early rather than changing the database yourself.

### Rules that prevent conflicts

- **Additive only.** Add tables and nullable columns. Don't drop or rename anything a teammate might use. `db:lint` blocks destructive SQL unless a reason is given.
- **One owner per table.** Agree who is changing which table.
- **Prefix by feature** when two people work in parallel, for example `poll_votes` and `poll_options`.
- **Never edit a migration that has been applied.** Write a new one.
- **Never change the schema in the dashboard or through MCP** without a matching migration file. Otherwise the next `db push` and the types drift from reality.

### If two migrations collide

Supabase applies files in timestamp order and rejects a file older than one already applied. If yours was overtaken, rename it with a new timestamp and push the change. Don't use `--include-all` on the shared database.

If two people add the same table, the second one to merge rewrites theirs as an `alter table`.

### Undoing a mistake

There's no reset on a shared database. Write a new forward migration that corrects the mistake, and include a `-- migration-allow: destructive <reason>` line if it has to remove something.

## Reviewing a migration

- Does every new public table have `enable row level security`, explicit grants and policies?
- Are policies `to authenticated` and owner-scoped, with nothing granted to `anon`?
- Is anything destructive? If so, is it really safe, and is everyone aware?
- If it uses Realtime, does the UI really need live updates?
- Do any new buckets stay private with limits?

## Secrets

- Teammates only need Docker and `npm run local:dev`; public local connection values are generated automatically.
- `.env.local` and `.env.test.local` are gitignored. Never commit them.
- Share values through a private channel the team trusts. Never put the secret key anywhere shared.
- CI needs no secrets. Hosted CI is opt-in and uses GitHub Actions secrets.

## Onboarding a new teammate

Send them the [README quick start](../README.md#quick-start) and this page. No shared keys are needed for local development. They should be running in under 5 minutes. `npm run doctor` tells them what's wrong if not.

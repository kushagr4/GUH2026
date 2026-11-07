# Developing against Supabase Cloud

EmberGap uses the team's **existing hosted Supabase project** for development, for the demo and for the Vercel deployment. Nothing runs in Docker, and there is no local database to start, reset or keep in sync.

## Set up (5 minutes)

You need Git and Node.js 22.12 or newer (24 recommended).

```bash
git clone https://github.com/kushagr4/GUH2026.git
```

```bash
cd GUH2026
```

```bash
npm ci
```

```bash
cp .env.example .env.local
```

Put the hosted project's two public values in `.env.local`. They are under Supabase Dashboard > Project Settings > API Keys, or the migration owner can give them to you with `npm run env:share`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

```bash
npm run doctor
```

```bash
npm run dev
```

Open <http://localhost:3000>, create an account, and check every service at <http://localhost:3000/dev>.

**Coming from the old Docker setup?** Your `.env.local` still has a managed block pointing at `127.0.0.1:54321`. Replace those two lines with the hosted values above; `npm run doctor` tells you if you missed it. You can stop old containers from Docker Desktop. That keeps their data, and nothing needs them any more.

## Sharing one database safely

Five people develop against the same project, so these rules keep everyone's work separate:

- **Your data is yours.** Every table has row-level security. Your reports, photos and investigations are visible only to you (and to reviewers), and nobody's code can change another person's rows with the publishable key.
- **Use your own account,** and create throwaway accounts for experiments. Never share passwords or sessions.
- **Synthetic demo data is read-only for everyone.** The six labelled scenarios are written by migrations, and only the service role can add evidence to them.
- **Only the migration owner changes the schema** (`supabase/MIGRATION_OWNER`), with `npm run db:push` from an up-to-date `main`. Everyone else adds a migration file to their PR. Never edit tables, policies or buckets in the dashboard, because the files are the only source of truth.
- **The secret key stays in two places:** Vercel and the migration owner's machine. It bypasses RLS, so it is never shared, never put in `.env.local` "to make something work", and never given a `NEXT_PUBLIC_` name. The app works without it; only agent runs need it.
- **Nothing resets or wipes the database.** No script can, and `npm run db:lint` blocks destructive SQL.
- **Free-plan limits are shared too:** 30 sign-ins per 5 minutes per IP, a 500 MB database and 1 GB storage. Don't loop sign-ups or uploads ([free-plan-usage.md](free-plan-usage.md)).

## Changing the schema

1. `npm run db:new -- add_things`, then fill in the template, with grants, RLS and owner policies in the same file.
2. `npm run db:lint`.
3. Open a PR with the migration and the code that needs it. Until it's applied, your feature should fail gracefully and `/dev` shows what's missing.
4. After merge, the migration owner applies it and checks the types:

```bash
npm run db:push
```

```bash
npm run db:types -- --check
```

If the types check fails, the owner commits regenerated types (`npm run db:types`) in a small PR.

## Tests

| Command | Touches the hosted project? |
| --- | --- |
| `npm test`, `npm run typecheck`, `npm run lint`, `npm run validate`, `npm run preflight` | No. Mocked, and safe to run any time |
| `npm run test:integration`, `npm run test:e2e` (signed-in cases) | Only if `.env.test.local` exists |

The integration and signed-in E2E tests need `SUPABASE_TEST_URL` and `SUPABASE_TEST_PUBLISHABLE_KEY` in `.env.test.local`, which `npm run env:test` writes for the migration owner. They create disposable `guh-test+…@example.test` users, touch only those users' rows, read the synthetic data, and delete those users afterwards. Without that file they report as **skipped**, which is not a pass. CI never runs them on pull requests.

## Deploying

Vercel runs the same code with the same environment variables. See [deployment.md](deployment.md).

## How the agents run

There are no long-lived workers. When a report is created, the route schedules a short investigation run with Next.js `after()`. The run writes queued tasks, each agent's findings and the recommended status to Supabase, and the investigation view shows progress from those rows. Running agents needs `SUPABASE_SECRET_KEY` on the server, so it happens on Vercel and the owner's machine. Everywhere else, reports still work and wait. Details are in [architecture.md](architecture.md#agent-runtime-on-vercel).

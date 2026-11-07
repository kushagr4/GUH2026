# Local development with Docker

Every teammate runs their own Supabase on their own laptop, using the **Supabase CLI's own Docker stack** (Postgres, Auth, Storage, Realtime, REST, Studio, Mailpit). Next.js runs on the host. There is no Docker Compose file to maintain: `supabase/config.toml` and `supabase/migrations/` are the whole definition.

You don't need a Supabase account, a Supabase key or the Supabase CLI installed globally. The CLI is a pinned dev dependency (`supabase` 3.0.0).

## Quick start

You need **Git**, **Node.js 22.12 or newer** (24 recommended) and **Docker Desktop**, which is free for personal use, education and small companies.

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
npm run local:dev
```

`local:dev` does all of this, and is safe to run again at any time:

1. Checks Docker. On macOS it opens Docker Desktop if it isn't running and waits for it.
2. Reuses the stack if it is already running. Otherwise it checks that the ports are free, then starts it. **The first start downloads about 1.3 GB of images, which takes a few minutes on good Wi-Fi and longer on venue Wi-Fi.** After that, a start takes seconds.
3. Applies any migration files your local database doesn't have yet (`supabase migration up`, which is additive).
4. Writes the local API URL and publishable key into a managed block in `.env.local`. Nothing else in the file is touched (see [Environment files](#environment-files)).
5. Starts Next.js at <http://localhost:3000>.

Then create an account at <http://localhost:3000/signup>, and check every service at <http://localhost:3000/dev>.

| What | Where |
| --- | --- |
| App | <http://localhost:3000> |
| Studio (tables, auth users, storage, SQL) | <http://127.0.0.1:54323> |
| Mailpit (any email Auth sends) | <http://127.0.0.1:54324> |
| API | <http://127.0.0.1:54321> |
| Postgres | `127.0.0.1:54322` |

## Commands

| Command | What it does |
| --- | --- |
| `npm run local:dev` | Everything above, then Next.js. Ctrl+C stops Next.js but leaves Supabase running |
| `npm run local:up` | The same, without Next.js. Then use `npm run dev` |
| `npm run local:status` | PASS/FAIL for Auth, REST and RLS, Storage, Realtime, Studio, and whether every migration file is applied |
| `npm run local:stop` | Stops the containers. **Your data is kept** |
| `npm run local:migrate` | Applies new migration files after a `git pull` (`local:dev` does this too) |
| `npm run local:types` | Regenerates `src/lib/supabase/database.types.ts` from the local schema. `-- --check` only compares |
| `npm run local:env` | Rewrites only the Supabase block in `.env.local` |
| `npm run local:test` | Integration tests and Playwright against the local stack. `-- integration` or `-- e2e` for one |
| `npm run local:reset` | Rebuilds the local database from migrations. **Deletes all local data**, so it asks for a flag |
| `npm run doctor` | Node, dependencies, Docker, `.env.local` and a live check of whichever Supabase it points at |

## Stopping, restarting and keeping data

- **Ctrl+C** in `local:dev` stops Next.js only. Supabase keeps running in the background and uses about 1 GB of memory.
- `npm run local:stop` stops the containers. The database lives in a Docker volume, so users, rows and files survive it, as well as Docker Desktop restarts and reboots.
- `npm run local:dev` brings everything back, with the same data.
- Two checkouts of this repo on one machine share the same local database, because the volume is named after `project_id` in `supabase/config.toml`.
- Data is only lost with `npm run local:reset -- --yes-delete-local-data`, `npx supabase stop --no-backup`, or by deleting the volumes in Docker Desktop. Never do any of those to "fix" something without meaning to wipe your local data.

## Environment files

`local:dev` and `local:env` maintain this block in `.env.local`:

```dotenv
# >>> local Supabase: managed by `npm run local:env`. Put your own settings outside this block. >>>
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
# <<< local Supabase <<<
```

- On a fresh clone, `.env.local` starts as a copy of `.env.example`, with the placeholders swapped for this block.
- **Your other settings are never changed.** Add `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `N8N_*`, `FIRECRAWL_API_KEY` and the rest outside the block, and every later run keeps them.
- **Only the public URL and publishable key are written.** The local secret key, service-role key, JWT secret and database password stay inside the CLI. The CLI's status output contains them, so the scripts capture it and never print it.
- **If `.env.local` points at the hosted project, nothing is changed.** The script stops and explains. To switch that checkout to local, run `npm run local:env -- --replace-hosted`. It saves a timestamped backup (`.env.local.backup-*`, gitignored), comments the hosted URL, key and any `SUPABASE_SECRET_KEY` out instead of deleting them, and adds the local block. To go back, restore the backup.
- A `NEXT_PUBLIC_SUPABASE_URL` exported in your shell, or set in `.env.development.local`, overrides `.env.local` in Next.js. `local:dev` warns you if so.

## Migrations

Each teammate's database is built only from `supabase/migrations/`, so the files are the shared truth and the data isn't shared.

1. `npm run db:new -- add_things`, then fill in the template (grants, RLS and policies in the same file).
2. `npm run local:migrate` applies it to your database. Try it in the app and Studio.
3. `npm run local:types` regenerates the types. Commit both files.
4. `npm run db:lint`, then open a PR. After `git pull`, teammates get it automatically on their next `local:dev`.

If a pulled migration is older than one you already applied, `local:migrate` says so. Run `npm run local:migrate -- --include-all`.

If you edited a migration that is already applied locally, the database won't re-run it. Write a new forward migration, or rebuild your own database with `npm run local:reset -- --yes-delete-local-data` if you're happy to lose your local data.

The hosted project is separate. Only the migration owner applies migrations there, with `npm run db:push` from `main` (see [team-workflow.md](team-workflow.md)). **Never use `db:*` for local work, and never use `local:*` to "fix" hosted.** `local:*` commands never pass `--remote`, and a unit test enforces that.

## Tests against the local stack

```bash
npm run local:test
```

This runs `tests/integration` (auth, RLS with cross-user isolation, private storage, Realtime) and Playwright, including the signed-in journey, against your local Supabase. It passes the local URL and keys to the test processes through the environment only, so nothing is written to disk. Shell values take precedence over `.env.test.local`, so a hosted test configuration can't leak into a local run. The tests create disposable `guh-test+...@example.test` users and remove them afterwards.

Plain `npm run test:integration` and `npm run test:e2e` still read `SUPABASE_TEST_*` from `.env.test.local` (for the hosted project), and skip hosted cases without it.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Docker was not found" | Install Docker Desktop: [Mac](https://docs.docker.com/desktop/setup/install/mac-install/) (Apple silicon or Intel), [Windows](https://docs.docker.com/desktop/setup/install/windows-install/) (WSL 2 backend), or [Docker Engine on Linux](https://docs.docker.com/engine/install/) |
| "Docker is installed but not running" | Open Docker Desktop and wait for "Engine running". On Linux, `sudo systemctl start docker`, and add yourself to the `docker` group |
| "These ports are already in use" | Usually another Supabase project. The message names it. Stop it from its own folder with `npx supabase stop`, or with `npx supabase stop --project-id <name>`. Its data is kept |
| Start is slow or times out | The first start downloads images. Give Docker Desktop at least 4 GB of memory (Settings > Resources), then run `npm run local:dev` again |
| "no space left on device" | Docker Desktop > Troubleshoot > Clean / Purge data, or `docker system prune` to remove unused images |
| `.env.local points at a hosted Supabase project` | Intended. Read [Environment files](#environment-files) |
| A table "is missing" | `npm run local:migrate`, then `npm run local:status` |
| Sign-in works but data is empty | Each laptop has its own database. Make an account locally |
| Windows: `local:dev` can't find Docker | Start Docker Desktop, open a new terminal so `docker` is on `PATH`, and run it from PowerShell or Windows Terminal |

## Security

- Local Supabase uses well-known development keys. It is for your laptop only. **Never expose its ports to the internet**, port-forward them, or deploy anything that points at `127.0.0.1`.
- Studio on port 54323 has no login. Don't run local Supabase on a shared or untrusted network with the ports open to others.
- `.env.local`, `.env.test.local` and `.env.local.backup-*` are gitignored. Never commit them. `npm run secrets:scan` checks.

## Public demos and deployment

Local Supabase is not a deployment backend. For a public demo URL, the deployed Next.js app uses the hosted free-plan project, configured in Vercel's environment settings (see [deployment.md](deployment.md)). Its migrations are applied by the migration owner with the guarded `db:*` scripts. Never put localhost addresses or local keys in Vercel, and keep sponsor keys server-side.

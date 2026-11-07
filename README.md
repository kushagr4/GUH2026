# GUH2026 Starter

A reusable foundation for building and demoing a web app at GreatUniHack 2026. It has working auth, a protected database, private file storage, Realtime and AI utilities, and no product idea yet.

**Stack:** Next.js 16, TypeScript, Tailwind CSS, shadcn/ui, Supabase, Vitest, Playwright.

**Every teammate runs their own Supabase locally in Docker.** There are no keys to ask for and no `.env` to fill in.

## Quick start

You need Git, Node.js 22.12 or newer (24 recommended) and [Docker Desktop](https://docs.docker.com/desktop/). Then:

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

`local:dev` starts Docker Desktop on macOS if it isn't running, starts the Supabase CLI's local stack (or reuses it), applies the migrations, writes the local URL and publishable key into `.env.local`, and runs Next.js. **The first run downloads about 1.3 GB of images**, so give it a few minutes (do it before the event, not on venue Wi-Fi). Later runs take seconds.

Then open <http://localhost:3000>, create an account, and try the service checks at <http://localhost:3000/dev>. Studio, where you can browse tables, users and files, is at <http://127.0.0.1:54323>.

- **Ctrl+C** stops Next.js. `npm run local:stop` stops Supabase too, and **keeps your data**.
- `npm run local:status` checks Auth, REST and RLS, Storage, Realtime, Studio and migrations.
- Put sponsor and AI keys (`ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY` and so on) in `.env.local`, outside the managed Supabase block. Later runs never change them.
- If your `.env.local` already points at the hosted project, `local:dev` leaves it alone and tells you how to switch.

The full guide, covering stopping without losing data, migrations, tests, troubleshooting and the hosted demo setup, is [docs/docker-development.md](docs/docker-development.md).

## What's included

| Path | What it is |
| --- | --- |
| `/` | Neutral landing page |
| `/login`, `/signup` | Email and password auth |
| `/app/*` | Signed-in pages. **Anything you add under `src/app/app/` is protected automatically** |
| `/app/account` | Example of the form, Server Action and repository pattern |
| `/dev/*` | Diagnostics for records, storage, Realtime and AI. Hidden in production |
| `/api/ai/chat` | Authenticated, rate-limited, streaming AI endpoint |
| `/api/health` | Liveness check that makes no database calls |

## Everyday commands

| Command | What it does |
| --- | --- |
| `npm run local:dev` | Start local Supabase and the app |
| `npm run local:stop` | Stop local Supabase. Data is kept |
| `npm run local:status` | Check every local service and the migrations |
| `npm run local:migrate`, `local:types` | Apply new migrations locally, regenerate database types |
| `npm run local:test` | Integration and Playwright tests against local Supabase |
| `npm run dev` | Start only the app, against whatever `.env.local` points at |
| `npm run doctor` | Check this machine's setup, Docker and the connection to Supabase |
| `npm run health` | Check that the configured Supabase (local or hosted) is up |
| `npm run validate` | Lint, types, unit tests, migration lint, secret scan, build and bundle scan |
| `npm test` | Unit tests, fully mocked, no network |
| `npm run db:new -- <name>` | Create a migration from the secure template |
| `npm run db:lint` | Check migrations for security and safety problems |

Only the migration owner needs `db:status`, `db:plan`, `db:push`, `db:types`, `db:audit`, `db:sweep-tests`, `env:share` and `env:test`, which act on the hosted project. `npm run local:test` runs the integration tests and the signed-in Playwright journey against your local stack. To run them against the hosted project instead, create `.env.test.local`, as described in [docs/supabase-setup.md](docs/supabase-setup.md).

Running `npm run test:e2e` needs a browser the first time: `npx playwright install chromium`.

## Working as a team

- **Changing the app?** Use a branch and open a pull request as usual. Your dev server, local database and `.env.local` are yours alone.
- **Changing the database?** Write a migration, try it with `npm run local:migrate`, and include it in your PR. Teammates get it on their next `local:dev` after pulling. Only the migration owner applies it to the hosted project. See [docs/team-workflow.md](docs/team-workflow.md).
- **Never reset the hosted database.** The demo's data lives there. A local reset only touches your own laptop, and still asks you to confirm.

## More documentation

- [docs/hackathon-day.md](docs/hackathon-day.md): the plan and commands for the day
- [docs/sponsor-strategy.md](docs/sponsor-strategy.md): judging checklist, sponsor decision matrix and three project concepts
- [docs/sponsor-comparison.md](docs/sponsor-comparison.md): ElevenLabs, n8n, Firecrawl, Lovable and GitHub compared, with free-tier limits
- [docs/integrations.md](docs/integrations.md): adding an external API, with timeouts, retries and rate limits
- [docs/live-verification.md](docs/live-verification.md): live checks and a go/no-go list for ElevenLabs and n8n
- [docs/team-workflow.md](docs/team-workflow.md): migration ownership, reviews and schema changes
- [docs/architecture.md](docs/architecture.md): how the code is organised and why
- [docs/supabase-setup.md](docs/supabase-setup.md): creating and configuring the hosted project (owner)
- [docs/free-plan-usage.md](docs/free-plan-usage.md): staying within free limits, health checks and monitoring
- [docs/deployment.md](docs/deployment.md): optional Vercel deployment
- [docs/optional-patterns.md](docs/optional-patterns.md): Edge Functions, Broadcast, OAuth and more
- [CLAUDE.md](CLAUDE.md): conventions and rules for Claude Code

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Docker was not found" or "is not running" | Install or open Docker Desktop. See [docs/docker-development.md](docs/docker-development.md#troubleshooting) |
| "These ports are already in use" | Another local Supabase project is running. The message says how to stop it |
| "Supabase is not connected yet" | `.env.local` is missing or still has placeholders. Run `npm run local:dev` |
| `npm run health` can't reach Supabase | `npm run local:up`, then `npm run local:status` |
| "Too many attempts from this network" | Auth allows 30 sign-ins and sign-ups per 5 minutes per IP, and a venue may share one IP. Wait a few minutes, or use a demo account |
| "Email address not authorized" or an email rate limit error | "Confirm email" is on. The owner turns it off ([docs/supabase-setup.md](docs/supabase-setup.md)) |
| A table "is missing" | Locally: `npm run local:migrate`. Hosted: ask the migration owner to run `npm run db:push` |
| Port 3000 is busy | `npm run dev -- -p 3001` |

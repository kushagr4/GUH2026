# GUH2026 Starter

A Next.js and Supabase hackathon starter. **Development is now Docker-first, with no manual Supabase env setup.** Every teammate runs the official local Supabase stack on their own laptop.

## Quick start

Install Node.js 22.12+, Git and Docker Desktop. Start Docker Desktop, then:

```bash
git clone https://github.com/kushagr4/GUH2026.git
cd GUH2026
npm ci
npm run local:dev
```

The command starts Supabase in Docker, automatically generates a gitignored `.env.local` containing only a **local public API URL and client key**, then launches Next.js. The first run downloads Docker images. Open http://localhost:3000 and Supabase Studio at http://127.0.0.1:54323.

If you already have a manually configured cloud `.env.local`, back it up or rename it first. The helper refuses to overwrite it.

Useful commands: `npm run local:up`, `npm run local:stop`, `npm run local:status`, `npm run local:types`, `npm run validate`.

Each teammate has an independent local database. Share migrations through Git and code review. Retain the hosted Supabase project only for deployed demos; local Docker Supabase must never be exposed to the internet.

See [docs/docker-development.md](docs/docker-development.md) for setup, migrations, security and the demo/deployment split.

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
| `npm run dev` | Start the app |
| `npm run doctor` | Check this machine's setup and the connection to Supabase |
| `npm run health` | Check that the selected Supabase project is up |
| `npm run validate` | Lint, types, unit tests, migration lint, secret scan, build and bundle scan |
| `npm test` | Unit tests, fully mocked, no network |
| `npm run db:new -- <name>` | Create a migration from the secure template |
| `npm run db:lint` | Check migrations for security and safety problems |

Only the migration owner needs `db:status`, `db:plan`, `db:push`, `db:types`, `db:audit`, `db:sweep-tests`, `env:share` and `env:test`. Anyone can run the hosted tests (`test:integration` and the hosted half of `test:e2e`) by creating `.env.test.local`, as described in [docs/supabase-setup.md](docs/supabase-setup.md).

Running `npm run test:e2e` needs a browser the first time: `npx playwright install chromium`.

## Working as a team

- **Changing the app?** Use a branch and open a pull request as usual. Your dev server and `.env.local` are yours alone, so frontend work never affects anyone else.
- **Changing the database?** Write a migration in your PR. Only the migration owner applies it to the shared database. See [docs/team-workflow.md](docs/team-workflow.md).
- **Never reset the shared database.** Everyone's data lives there.

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
| "Supabase is not connected yet" | `.env.local` is missing or still has placeholders. Fix it, then restart `npm run dev` |
| `npm run health` can't reach the project | Start the local containers with npm run local:up |
| "Too many attempts from this network" | Auth allows 30 sign-ins and sign-ups per 5 minutes per IP, and a venue may share one IP. Wait a few minutes, or use a demo account |
| "Email address not authorized" or an email rate limit error | "Confirm email" is on. The owner turns it off ([docs/supabase-setup.md](docs/supabase-setup.md)) |
| A table "is missing" | The migration hasn't been applied yet. Ask the migration owner to run `npm run db:push` |
| Port 3000 is busy | `npm run dev -- -p 3001` |

# GUH2026 Starter

A reusable foundation for GreatUniHack 2026, now being developed into **EmberGap**, a collaborative wildfire-evidence investigation prototype. The existing starter includes working auth, protected database, private storage, Realtime and AI utilities.

**Stack:** Next.js 16, TypeScript, Tailwind CSS, shadcn/ui, hosted Supabase (Auth, Postgres, private Storage, Realtime), Vercel, Vitest, Playwright.

**Everyone develops against the team's existing hosted Supabase project.** There is no Docker and no local database: clone, add two public values to `.env.local`, and run `npm run dev`.

## EmberGap: who builds what

The active GreatUniHack project is **EmberGap**, a multi-agent wildfire-evidence investigation prototype. **Exact APIs, owner, keys and endpoints:** [docs/embergap-api-ownership.md](docs/embergap-api-ownership.md). Full technical boundaries, API contracts and safety rules: [docs/architecture.md](docs/architecture.md#five-contributor-work-split-definitive-ownership). Agent-specific rules: [CLAUDE.md](CLAUDE.md) and [AGENTS.md](AGENTS.md).

| Contributor | Workstream | Dedicated branch |
| --- | --- | --- |
| **Claude on Mac** | Shared contracts, database migrations, secure **POST report API**, private photo storage, final integration | `feat/embergap-core` |
| **Claude on PC** | **Open-Meteo + EONET APIs**, autonomous worker queues, network partitions, reconciliation | `feat/embergap-data-runtime` |
| **Danil** | Claude Vision, witness checks, independent evidence validation and fusion | `feat/embergap-validation` |
| **Outrolife** | **NASA FIRMS API, GET map + investigation APIs, map/dashboard UI** | `feat/embergap-map-api` |
| **d3vmakes** | Human-report form/UI, basic interaction tests and one short internal QA walkthrough | `feat/embergap-report-ui` |

**Start in parallel.** Mac publishes shared types first; Outrolife can start the read APIs and map with deterministic mock fixtures without waiting for the backend. d3vmakes can start the form against mock POST responses. Mac is the sole owner of shared contracts, migrations, and root navigation. **Minimal manual user testing only:** one short internal walkthrough. Do not skip automated security, CI or critical agent correctness tests. Every change still uses a feature branch and PR, but no mandatory review; keep automated checks.

## Quick start

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

Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `.env.local` to the hosted project's values (Supabase Dashboard > Project Settings > API Keys, or ask the migration owner). Then:

```bash
npm run dev
```

Open <http://localhost:3000>, create an account, and try the service checks at <http://localhost:3000/dev>. `npm run doctor` explains anything that's missing.

- You share one database with the team, protected by row-level security. Read the rules in [docs/supabase-cloud-development.md](docs/supabase-cloud-development.md) first.
- Put AI and sponsor keys (`ANTHROPIC_API_KEY`, `NASA_FIRMS_MAP_KEY` and so on) in `.env.local` too. They are server-only.
- Never put `SUPABASE_SECRET_KEY` in `.env.local` unless you are the migration owner. Agent runs use it on Vercel.
- Deploying: [docs/deployment.md](docs/deployment.md).

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
| `npm run dev` | Start the app against the hosted project in `.env.local` |
| `npm run build`, `npm run start` | Production build and server, as Vercel runs it |
| `npm run lint`, `npm run typecheck` | ESLint and TypeScript |
| `npm run doctor` | Check this machine's setup and the connection to Supabase |
| `npm run health` | Check that the hosted project is up |
| `npm run validate` | Workflow lint, ESLint, types, unit tests, migration lint, secret scan, build and bundle scan |
| `npm run preflight` | Everything CI's PR Checks runs, including the browser smoke tests, with a summary |
| `npm test` | Unit tests, fully mocked, no network |
| `npm run db:new -- <name>` | Create a migration from the secure template |
| `npm run db:lint` | Check migrations for security and safety problems |

Only the migration owner needs `db:status`, `db:plan`, `db:push`, `db:types`, `db:audit`, `db:sweep-tests`, `env:share` and `env:test`, which act on the hosted project. The integration tests and the signed-in Playwright journey run against the hosted project with disposable users, and only when `.env.test.local` exists ([docs/supabase-cloud-development.md](docs/supabase-cloud-development.md#tests)).

Running `npm run test:e2e` needs a browser the first time: `npx playwright install chromium`.

## Working as a team

- **Changing the app?** Use a `feat/`, `fix/` or `chore/` branch, and open a normal pull request. No Claude self-review or human approval is required. Keep automated **PR Checks** and let the human owner merge. See [docs/development-workflow.md](docs/development-workflow.md). Your dev server, local database and `.env.local` are yours alone, so your work never affects anyone else until it is merged.
- **Changing the database?** Write a migration (`npm run db:new`), check it with `npm run db:lint`, and include it in your PR. Only the migration owner applies it to the hosted project. See [docs/team-workflow.md](docs/team-workflow.md).
- **Never reset or wipe the hosted database.** Everyone's data and the demo live there.

## More documentation

- [docs/supabase-cloud-development.md](docs/supabase-cloud-development.md): developing against the hosted project safely, migrations, tests and agents
- [docs/hackathon-day.md](docs/hackathon-day.md): the plan and commands for the day
- [docs/sponsor-strategy.md](docs/sponsor-strategy.md): judging checklist, sponsor decision matrix and three project concepts
- [docs/sponsor-comparison.md](docs/sponsor-comparison.md): ElevenLabs, n8n, Firecrawl, Lovable and GitHub compared, with free-tier limits
- [docs/integrations.md](docs/integrations.md): adding an external API, with timeouts, retries and rate limits
- [docs/live-verification.md](docs/live-verification.md): live checks and a go/no-go list for ElevenLabs and n8n
- [docs/development-workflow.md](docs/development-workflow.md): feature branches, quick PRs, CI and human-controlled merging
- [docs/debugging-workflow.md](docs/debugging-workflow.md): reproduce, find the root cause, test, fix
- [docs/ci-and-reviews.md](docs/ci-and-reviews.md): what CI runs, fixing a red build, and what GitHub can and can't enforce
- [docs/team-workflow.md](docs/team-workflow.md): migration ownership and schema changes
- [docs/architecture.md](docs/architecture.md): how the code is organised and why
- [docs/supabase-setup.md](docs/supabase-setup.md): creating and configuring the hosted project (owner)
- [docs/free-plan-usage.md](docs/free-plan-usage.md): staying within free limits, health checks and monitoring
- [docs/deployment.md](docs/deployment.md): optional Vercel deployment
- [docs/optional-patterns.md](docs/optional-patterns.md): Edge Functions, Broadcast, OAuth and more
- [CLAUDE.md](CLAUDE.md): conventions and rules for Claude Code

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Supabase is not connected yet" | `.env.local` is missing or still has placeholders. Set the hosted URL and publishable key |
| `.env.local` "still points at the old local Docker stack" | Replace the `127.0.0.1` values with the hosted project's |
| `npm run health` can't reach Supabase | The free project may be paused. The owner restores it in the dashboard |
| "Too many attempts from this network" | Auth allows 30 sign-ins and sign-ups per 5 minutes per IP, and a venue may share one IP. Wait a few minutes, or use a demo account |
| "Email address not authorized" or an email rate limit error | "Confirm email" is on. The owner turns it off ([docs/supabase-setup.md](docs/supabase-setup.md)) |
| A table "is missing" | The migration isn't applied yet: ask the migration owner to run `npm run db:push` |
| Port 3000 is busy | `npm run dev -- -p 3001` |

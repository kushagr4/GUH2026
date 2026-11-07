# Local Docker development

The default environment is Next.js on the host machine, plus Supabase's **official CLI-managed local Docker stack**. Do not add a separate Compose stack for Supabase.

## Teammate quick start

Install Node.js 22.12 or later and Docker Desktop, then start Docker Desktop.

```bash
git clone https://github.com/kushagr4/GUH2026.git
cd GUH2026
npm ci
npm run local:dev
```

On the first start, the CLI downloads the Docker images, boots local Postgres, Auth, Storage, Realtime and Studio, and applies existing migrations. The helper parses `supabase status -o env` privately and generates **only** the local API URL and browser-safe key into gitignored `.env.local`. No cloud account or manual `.env` setup is needed.

App: http://localhost:3000
Supabase Studio: http://127.0.0.1:54323

If `.env.local` was manually configured for the hosted project, rename or back it up first. The script refuses to overwrite it.

Other commands: `npm run local:up` starts only Supabase; `npm run local:status` checks it; `npm run local:stop` retains local data; `npm run local:env` refreshes the generated public settings; `npm run local:types` generates types from the local schema.

Each developer owns an **independent local database**. Code and migrations sync through Git, not the data. After pulling new migrations, check `npx supabase migration up --help` and apply them locally. Never use the existing `npm run db:push` for local changes: it deliberately targets the shared hosted project.

Local resets are destructive. The wrapper only permits one when `GUH_ALLOW_LOCAL_RESET=true` is explicitly set and targets `--local`. Never reset hosted Supabase.

Run `npm run validate` for source checks. Hosted integration tests remain separately opt-in and cannot silently access the local instance. New local integration automation must stay isolated and cleanup-safe.

## Public demos

**Local Supabase is not a deployment backend.** It uses development credentials and is not hardened or exposed publicly. For a judges' demo at a public URL, retain GUH2026-dev on Supabase Cloud and point the deployed Next.js instance to the hosted project. The designated migration owner can use the existing guarded remote migration scripts. Do not deploy localhost addresses or local keys to Vercel. Keep sponsor keys server-side.

Troubleshooting: start Docker Desktop, check ports 54321-54323, rerun `npm run local:up`, or back up an existing `.env.local` before retrying.

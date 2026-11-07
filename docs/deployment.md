# Deploying to Vercel

EmberGap is a standard Next.js 16 app. Vercel builds it with no configuration and no Docker, and it talks to the team's existing hosted Supabase project. Nothing has been deployed yet: these are the steps for the person with access to the Vercel team and the Supabase dashboard.

Vercel's Hobby plan is free for personal, non-commercial projects and needs no card. Never enable a paid resource for this event.

## 1. Import the project

Sign in at [vercel.com](https://vercel.com) with GitHub and import `kushagr4/GUH2026`. Keep the detected defaults: framework Next.js, build `npm run build`, install `npm ci`, output `.next`. `vercel.json` only pins functions to London (`lhr1`, next to a `eu-west-2` Supabase project; change or remove it if the project is elsewhere).

## 2. Environment variables

Add these under **Settings > Environment Variables**. Mark everything except the two `NEXT_PUBLIC_` values as **Sensitive**, and never give a secret a `NEXT_PUBLIC_` name: those are built into the browser bundle.

| Name | Environments | Required | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Production, Preview, Development | Yes | The existing project's URL. Public |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Production, Preview, Development | Yes | Publishable key. Public, because RLS protects the data |
| `SUPABASE_SECRET_KEY` | Production (and Preview if you demo there) | For agents | Server-only, **bypasses RLS**. Agent runs need it to record findings. Without it reports still work and investigations wait |
| `ANTHROPIC_API_KEY` | Production, Preview | Optional | Claude Vision and AI routes. Server-only |
| `AI_PROVIDER` | Any | Optional | `mock` for offline AI in a demo without a key |
| `NASA_FIRMS_MAP_KEY` | Production, Preview | Optional | Live FIRMS, with `EMBERGAP_FIRMS_MODE=live`. Without both, the map shows labelled synthetic fixtures and real reports record satellite data as unavailable |
| `EMBERGAP_FIRMS_MODE` | Production, Preview | Optional | `live` to query FIRMS. Not secret |
| Sponsor keys (`ELEVENLABS_API_KEY`, `N8N_*`, `FIRECRAWL_API_KEY`, `GITHUB_API_TOKEN`) | As needed | Optional | Server-only, see `.env.example` |

Don't set `ENABLE_DEV_TOOLS`, so `/dev` stays hidden in production. `NEXT_PUBLIC_*` values are built in at build time: redeploy after changing them. Open-Meteo and NASA EONET need no key.

## 3. Supabase settings (dashboard, once)

- **Authentication > URL Configuration:** set **Site URL** to the production URL, for example `https://embergap.vercel.app`, and add `https://<your-app>.vercel.app/**` and `http://localhost:3000/**` to **Redirect URLs**. Password sign-in doesn't use redirects, but email links and OAuth do. The `/auth/callback` route redirects to the request's own origin, so any listed domain works.
- **Authentication > Providers > Email:** keep **Confirm email** off ([supabase-setup.md](supabase-setup.md)).
- **Migrations:** the migration owner applies everything in `supabase/migrations/` that the hosted project doesn't have yet (`npm run db:status`, then `npm run db:push` from an up-to-date `main`).

## 4. Deploy and check

Deploy, then:

1. Open the site, sign up, and sign in.
2. `/api/health` reports `supabaseConfigured: true`, and `/dev` returns 404.
3. Submit a report. It returns 201 and an `unreviewed` investigation. With `SUPABASE_SECRET_KEY` set, within seconds `GET /api/embergap/investigations/<id>` shows six `task_queued` events (five sources and fusion), a finding from each of witness, vision, satellite, weather and fusion, the sources' observations, a `status_changed` "Automated assessment finished" event and the fusion agent's recommended status. Without `EMBERGAP_FIRMS_MODE=live` and a FIRMS key, satellite is recorded as "not configured"; without a live vision model, a photo is recorded as "not analysed". Both are gaps, never invented results. If a run is cut short, `POST /api/embergap/runs` with `{ "investigationId": "<id>" }` restarts it.

## How it runs on Vercel

- **Pages, Route Handlers and Server Actions** run on the Node.js runtime, which is the default; `node:crypto` is used for photo fingerprints.
- **Agents** run inside the request that created the report, after the response, via Next.js `after()`. `POST /api/embergap/reports` sets `maxDuration = 60`. There are no background workers, cron jobs or queues to configure ([architecture.md](architecture.md#agent-runtime-on-vercel)).
- **Rate limits** are in memory per function instance, so they are a soft limit on Vercel. The database's per-reporter unique key and the free-plan auth limits are the backstops.
- **Every deployment shares the one database:** production, previews and laptops alike. Preview deployments write real (RLS-protected) rows. The secret key goes only where agents should run.
- **Pushes to `main` deploy**, and pull requests get preview URLs once the project is imported.

# Architecture

## Overview

```
 Each developer laptop                               Supabase Cloud (free plan)
┌──────────────────────────────────────────┐        ┌──────────────────────────┐
│ npm run local:dev                        │        │ Hosted project, for the  │
│  Next.js (localhost:3000)                │        │ deployed demo only       │
│   ├─ browser client ─┐ publishable key   │        │  Auth, Postgres (RLS),   │
│   ├─ server client ──┤ + user session    │        │  Storage, Realtime       │
│   └─ proxy.ts        ▼                   │        └────────────▲─────────────┘
│  Supabase CLI stack in Docker            │                     │
│   (127.0.0.1:54321) Auth, Postgres (RLS),│   Migration owner,  │
│   Storage, Realtime, REST, Studio        │   from main only:   │
│   built from supabase/migrations/        │   npm run db:push ──┘
└──────────────────────────────────────────┘
```

Every developer runs their own Next.js server and their own Supabase, so neither frontend work nor data can disturb anyone else. Migrations in Git are the shared truth: they build every local database, and the owner applies them to the hosted project, as described in [team-workflow.md](team-workflow.md).

## Why these decisions

| Decision | Reason |
| --- | --- |
| Local Supabase per developer, via the CLI's own Docker stack | No shared keys to hand out, no rate limits or shared data to trip over, and one command to set up. No Compose file to maintain |
| One hosted project on the free plan, for the demo | The team's budget. Only the migration owner changes it |
| CLI `db push` for migrations, MCP read-only | One write path keeps the migration history correct |
| Next.js proxy protects all of `/app/*` | New pages are secure by default, with no list to maintain |
| Password auth, with "Confirm email" off | The built-in mailer is too restricted to rely on in a demo |
| Profiles created on first save | Avoids a trigger on `auth.users`, so no `SECURITY DEFINER` is needed |
| Browser uploads straight to Storage | Bucket RLS and limits apply, and no file passes through the server |
| System fonts | No network dependency at build time on venue Wi-Fi |

## Request flow

1. `src/proxy.ts` runs on every non-asset request. It refreshes the session cookie with `getClaims()`, returns 404 for `/dev/*` when dev tools are off, and redirects signed-out visitors away from `/app/*`.
2. Pages and layouts call `requireUser()` or `getCurrentUser()`, which verify the token and are cached per request.
3. Data access uses `createClient()` from `lib/supabase/server.ts`, acting as the signed-in user. **RLS is the real security boundary**, and the proxy and page checks are for user experience.

## Supabase clients

| File | Where | Identity |
| --- | --- | --- |
| `lib/supabase/client.ts` | Browser | Signed-in user, publishable key |
| `lib/supabase/server.ts` | Server Components, Actions, Route Handlers | Signed-in user, publishable key |
| `lib/supabase/proxy.ts` | Proxy only | Refreshes the session |
| `lib/supabase/admin.ts` | Server only, currently unused | **Bypasses RLS.** Secret key |

## Security layers

| Layer | Protects against |
| --- | --- |
| Explicit `GRANT`s, nothing to `anon` | Anonymous API access |
| RLS with owner policies | One user reaching another's rows |
| Storage policies by `<user id>/` folder | One user reaching another's files |
| Bucket size and type limits | Quota exhaustion and hosted script files |
| `server-only` imports, `scripts/check-client-bundle.mjs` | Secrets in browser code |
| `isPrivilegedKey` in `lib/env.ts` | A secret key pasted into the public variable |
| `safeRedirectPath` | Open redirects |
| `scripts/check-migrations.mjs` | Insecure or destructive SQL reaching review |
| `scripts/scan-secrets.mjs` | Credentials in files or Git history |

## Testing strategy

| Layer | Where | Needs | What it proves |
| --- | --- | --- | --- |
| Unit | `tests/unit` | Nothing | Logic, with Supabase and the network mocked |
| Integration | `tests/integration` | `.env.test.local` with the public values | Real RLS, auth, storage and Realtime boundaries |
| E2E smoke | `e2e/smoke.spec.ts` | Nothing (builds the app) | Pages, redirects, headers, production gate |
| E2E hosted | `e2e/hosted.spec.ts` | `.env.test.local` with the public values | The whole journey in a real browser |

The free-plan constraint means there is one project, so there is no separate test environment. Hosted tests stay safe because they:

- only run with `SUPABASE_TEST_*`, never from a normal `.env.local`
- sign up disposable users named `guh-test+<uuid>@example.test`, through the same public API as real visitors
- touch only rows and files those users own, which RLS enforces
- need no privileged key, so they can't reach anyone else's data even if a test is wrong
- leave only empty accounts behind, cleared with `npm run db:sweep-tests`, which matches that exact email pattern

## AI utilities

`src/lib/ai` exposes one small interface, `AiProvider`, with `streamText`, `generateText` and `generateObject`.

- **Anthropic provider:** the default when `ANTHROPIC_API_KEY` is set. Uses `claude-opus-5-5` with adaptive thinking and streaming. Server-side refusal fallback is on, so a safety decline re-runs on Anthropic's recommended fallback model rather than dead-ending. Change the model and effort with `AI_MODEL` and `AI_EFFORT`.
- **Mock provider:** `AI_PROVIDER=mock`. Offline, deterministic and free. Useful for UI work, tests and as a demo safety net if the network or API fails.
- `/api/ai/chat` requires a session, validates its input, and rate limits to 20 requests a minute per user on each server instance. That is a safety net rather than a billing control, so also set a spending limit in the Anthropic Console.

To add another provider, implement `AiProvider` in `src/lib/ai/providers/` and select it in `src/lib/ai/index.ts`.

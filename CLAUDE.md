@AGENTS.md

# GUH2026 Starter

A reusable Next.js and Supabase foundation for GreatUniHack 2026. It contains generic infrastructure and no competition idea until the event begins. Optimise for development speed, reliability and demo readiness over advanced infrastructure.

## Non-negotiable constraints

- **Docker-first local development.** Use `npm run local:dev` to run the CLI-managed Supabase Docker stack and frontend. Local resets require explicit opt-in.
- **Local by default.** Each teammate has independent Docker-backed Supabase. Keep the hosted Free project only for deployments and shared demos; do not add paid services.
- **Never reset the hosted database or delete teammates' data.** Explicitly authorized local-only resets may delete only the caller's local DB.
- **Only the designated migration owner deploys hosted migrations** (`supabase/MIGRATION_OWNER`). Everyone else opens a PR containing the migration file.
- **All schema changes go through version-controlled files** in `supabase/migrations/`. Never change the schema through the dashboard or MCP without a matching migration file.

## Local development\n\nRead `docs/docker-development.md`. Run `npm ci && npm run local:dev` with Docker Desktop active. Local client env is generated automatically. Do not log the CLI status output, which contains privileged values. The existing `db:*` wrappers still target the hosted project and must never be used for local development.\n\n## Architecture

```
src/app/            Routes only. Keep them thin.
  app/              Signed-in product pages (/app/*), protected by src/proxy.ts
  (auth)/           /login and /signup
  dev/              Diagnostics (/dev/*), hidden in production
  api/              Route handlers
src/features/<x>/   One folder per feature: actions.ts, repository.ts, components/
  dev-smoke/        Infrastructure smoke test. Do NOT build product features on it
src/components/     Shared components. ui/ is shadcn, the rest are ours
src/config/site.ts  Product name and navigation. Rename the product here
src/lib/
  env.ts            All public env access and validation
  routes.ts         Route constants, safeRedirectPath()
  supabase/         client.ts (browser), server.ts, proxy.ts, auth.ts, admin.ts, types
  db/               result.ts (DbResult), pagination.ts (toPageRange)
  storage/          Upload limits and owner-scoped object paths
  realtime/         useTableChanges hook
  ai/               Provider interface, Anthropic and mock providers
  integrations/     External APIs: createApiClient, env checks, errors, ElevenLabs, n8n, Firecrawl, GitHub
  rate-limit.ts     In-memory limiter shared by AI and integrations
supabase/migrations/  The only source of schema truth
scripts/            Node scripts with no dependencies. No shell-specific syntax
tests/unit/         Mocked, no network. Runs everywhere
tests/integration/  Real hosted project, disposable users. Owner only
e2e/                Playwright. smoke needs no backend, hosted needs SUPABASE_TEST_*
```

## Adding a feature

1. If it needs data: `npm run db:new -- add_things`, and fill in the template. It needs explicit grants, RLS and policies in the same file. New public tables get no Data API access without explicit `GRANT`s.
2. Pages go in `src/app/app/<feature>/`, and are protected automatically.
3. Create `src/features/<feature>/` with `repository.ts`, `actions.ts` and `components/`. Copy `src/features/account/` as the reference.
4. Use `getCurrentUser()` or `requireUser()` from `@/lib/supabase/auth`, and `createClient()` from `@/lib/supabase/server`.
5. Add a nav link in `src/config/site.ts`.

## Coding conventions

- Server Components by default. Add `"use client"` only for interactivity.
- Mutations go through Server Actions. Validate with zod and return a typed state rather than throwing to the UI.
- Repository functions take a client, select only the columns they need, and return `DbResult<T>`. Lists use `toPageRange`, so no query is unbounded.
- Never show raw database or auth error messages to users. Use `toDbError` and `friendlyAuthError`.
- Build UI from `src/components/ui/`. Add more with `npx shadcn@4.23.0 add <name>`.
- Use `safeRedirectPath()` for any redirect target that comes from a request.
- Pin exact dependency versions (`.npmrc` has `save-exact`). Avoid new dependencies unless they clearly save time.
- TypeScript stays on 5.x and ESLint on 9.x because `eslint-config-next` does not support newer majors yet.

## Security requirements

- **Keys:** only `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` reaches browsers. `SUPABASE_SECRET_KEY` and `ANTHROPIC_API_KEY` are server-only, read only in modules that import `server-only`, and never get a `NEXT_PUBLIC_` prefix.
- **Env files:** only `.env.example` is committed, with placeholders. Never print, log or paste credential values.
- **Never run `supabase projects api-keys` directly.** It prints the legacy `service_role` key in full even without `--reveal`. Use `npm run env:share` for the public values. Don't fetch the secret key at all, unless the user does it themselves.
- **RLS:** every public table has RLS enabled and owner-aware policies, written with `(select auth.uid())` and scoped `to authenticated`. Do not grant anything to `anon` without a deliberate, reviewed reason.
- **Functions:** avoid `SECURITY DEFINER`. If one is truly necessary, pin `search_path`, keep it out of exposed schemas, and waive the lint with a reason.
- **Storage:** buckets are private with `file_size_limit` and `allowed_mime_types`. Objects live under `<user id>/`.
- **External APIs** go through `createApiClient` in `src/lib/integrations` (see `docs/integrations.md`), never a bare `fetch` with a key. Integration variables are server-only. Never connect Lovable's Supabase integration to the shared project: it applies schema changes outside our migrations. Never give n8n the Supabase secret key: n8n calls the app instead.
- **`createAdminClient()`** bypasses RLS. Avoid it unless there is no user session, and check authorization yourself first.
- `npm run db:lint` enforces most of this. Waive a rule only with `-- migration-allow: <rule> <reason>`.

## Free-plan discipline

- Select only the columns you need, always paginate, and never poll. `getCurrentUser` is cached per request.
- Realtime: subscribe only on pages that show live data, one channel per component, with a filter where possible. Use `useTableChanges`, which sends the user's token before joining and handles cleanup. If you open a channel yourself, `await supabase.realtime.setAuth()` first. Otherwise the join can go out with only the publishable key, RLS treats the subscriber as anonymous, and no changes arrive.
- Uploads: 5 MB per file by default. Go browser to Storage directly so files don't pass through the server.
- Auth emails: the built-in mailer only reaches organisation members, at about 2 emails an hour. "Confirm email" stays off, and don't build a flow that depends on email.
- See `docs/free-plan-usage.md`.

## Scripts

| Script | Purpose |
| --- | --- |
| `dev`, `build`, `start` | Next.js |
| `lint`, `typecheck` | ESLint and TypeScript |
| `test`, `test:watch` | Mocked unit tests |
| `test:integration` | Hosted RLS, auth, storage and Realtime tests (needs `.env.test.local`, public values only) |
| `test:e2e` | Playwright. Hosted journeys skip without `SUPABASE_TEST_*` |
| `validate` | Everything that runs without the hosted project, including the build |
| `doctor`, `health` | Machine setup and project health |
| `db:new`, `db:lint` | Create and check migrations (anyone) |
| `db:status`, `db:plan`, `db:push`, `db:types`, `db:audit`, `db:sweep-tests`, `env:share`, `env:test` | Hosted operations (migration owner) |
| `secrets:scan`, `check:bundle` | Credential scan of files and history; scan of the built client bundle |

Use `local:*` scripts for Docker development. The existing `db:*` scripts remain owner-only hosted operations. Explicitly scope CLI commands to local or remote.

## MCP

`.mcp.json` connects to the official Supabase MCP server, scoped to the shared project in read-only mode. Use it to inspect the schema, logs and advisors. Apply schema changes through migration files and `npm run db:push`, not through MCP.

## Hackathon-day practices

- Hacking is short (see `docs/hackathon-day.md`). Keep PRs small and merge often. Keep `main` demoable at all times.
- Run `npm run validate` before merging anything risky.
- Schema changes are additive. Don't rename or drop a column a teammate might be using.
- Keep the `/dev` pages until the end. They are the fastest way to tell whether a problem is in the infrastructure or in your feature.
- Before any commit of secrets-adjacent work, run `npm run secrets:scan`.
- Report honestly: don't say a check passed unless it ran and passed. Hosted tests skip without credentials, and a skip is not a pass.

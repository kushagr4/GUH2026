@AGENTS.md

# GUH2026 Starter

A reusable Next.js and Supabase foundation for GreatUniHack 2026. It contains generic infrastructure and no competition idea until the event begins. Optimise for development speed, reliability and demo readiness over advanced infrastructure.

## Non-negotiable constraints

- **Local development runs on the Supabase CLI's own Docker stack.** `npm run local:dev` starts it, applies migrations, writes `.env.local` and runs Next.js. Don't add a separate Docker Compose stack for Supabase.
- **Each teammate has an independent local database.** The hosted free-plan project is only for deployments and shared demos. Never enable paid services, add-ons or database branching, and never create billable resources.
- **Never reset the hosted database or delete teammates' data.** Hosted migrations are additive. A local reset (`npm run local:reset -- --yes-delete-local-data`) wipes only the caller's own local data, so ask the user before running it.
- **Only the designated migration owner deploys hosted migrations** (`supabase/MIGRATION_OWNER`). Everyone else opens a PR containing the migration file.
- **All schema changes go through version-controlled files** in `supabase/migrations/`. Never change the schema through Studio, the dashboard or MCP without a matching migration file.
- **Keep local and hosted commands apart.** `local:*` scripts are local only and never pass `--remote`. `db:status`, `db:plan`, `db:push`, `db:types`, `db:audit` and `db:sweep-tests` are hosted, owner-only operations. Don't call the CLI directly with `--remote`.

## Local development

Read `docs/docker-development.md`. With Docker Desktop running, `npm ci && npm run local:dev` is the whole setup, and it is safe to rerun. `npm run local:stop` keeps data. `npm run local:status` checks every service. The CLI's `start` and `status` output contains privileged local keys, so never print or log it: use the `local:*` scripts, which capture it. `.env.local` has a managed Supabase block. Keep sponsor and AI keys outside it.

## Architecture

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
scripts/            Node scripts, no shell-specific syntax. Only check-workflows.mjs uses a package (yaml)
.github/            CI (ci.yml, one "PR Checks" job), review status, PR template, CODEOWNERS
.claude/            Skills (feature-dev, bugfix, self-review), helper agents, git guard hook
tests/unit/         Mocked, no network. Runs everywhere
tests/integration/  Real Supabase (local via local:test, or hosted), disposable users
e2e/                Playwright. smoke needs no backend, the signed-in journey needs SUPABASE_TEST_*
```

## Adding a feature

1. If it needs data: `npm run db:new -- add_things`, fill in the template, then `npm run local:migrate` and `npm run local:types`. It needs explicit grants, RLS and policies in the same file. New public tables get no Data API access without explicit `GRANT`s.
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
| `test:integration` | RLS, auth, storage and Realtime tests against whatever `SUPABASE_TEST_*` points at (hosted via `.env.test.local`) |
| `test:e2e` | Playwright. Signed-in journeys skip without `SUPABASE_TEST_*` |
| `validate` | Everything that runs without the hosted project, including the build |
| `preflight` | What CI's PR Checks job runs, in order, with a summary. Run before marking a PR ready |
| `check:workflows`, `check:commits` | GitHub Actions workflow lint; Conventional Commit check of this branch's commits |
| `doctor`, `health` | Machine setup and project health |
| `db:new`, `db:lint` | Create and check migrations (anyone) |
| `db:status`, `db:plan`, `db:push`, `db:types`, `db:audit`, `db:sweep-tests`, `env:share`, `env:test` | Hosted operations (migration owner) |
| `secrets:scan`, `check:bundle` | Credential scan of files and history; scan of the built client bundle |
| `local:dev`, `local:up`, `local:stop`, `local:status` | Run, stop and check the local Docker stack. Stopping keeps data |
| `local:env`, `local:migrate`, `local:types` | Rewrite the `.env.local` Supabase block, apply new migrations locally, regenerate types locally |
| `local:test` | Integration and Playwright tests against the local stack |
| `local:reset` | Rebuild the local database. Deletes local data. Needs `-- --yes-delete-local-data` and the user's approval |

Supabase CLI v3 targets the local stack by default, and hosted commands need `--remote`. The `local:*` and `db:*` scripts handle this. Prefer them over calling the CLI directly.

## Workflow: branches, PRs and reviews

Every change reaches `main` through a focused PR with green **PR Checks** and one approval from someone other than its author. Details: `docs/development-workflow.md` and `docs/ci-and-reviews.md`.

- **Building or changing behaviour?** Follow `/feature-dev` (`.claude/skills/feature-dev/SKILL.md`) before writing code. **Fixing a bug?** Follow `/bugfix`. Scale both to the change: a trivial edit needs no helper agents.
- **Branches:** `feat/<issue>-<name>`, `fix/<issue>-<name>`, `refactor/<issue>-<name>` or `chore/<name>`, from an up-to-date `main`. GitHub Issues are the tickets; drop the number when there's none. Never work on `main`.
- **Commits and PR titles** are Conventional Commits: `type(scope): lowercase description`, with no full stop. CI fails on a bad PR title, because it becomes the squash commit.
- **Draft first.** Open PRs with `gh pr create --draft`. Before `gh pr ready`: tests written, `npm run preflight` passing, and `/self-review` clean of Critical and Important findings. Then request one human reviewer with `gh pr edit --add-reviewer <login>`.
- **Never merge, never approve, never push to `main`.** That's a person's job. `.claude/hooks/git-guard.mjs` denies `gh pr merge`, approvals, pushes to `main`, and `gh pr ready` before `/self-review` has passed for exactly the branch's diff. Never use `SKIP_GIT_GUARD=1` unless the user asks. After touching a hook, run `npx vitest run tests/unit/git-guard.test.ts`.
- **GitHub can't enforce the review rule** on this private repo's plan. The "Human review" status is advisory. Never claim reviews are enforced.
- `/self-review` is Claude's own review. It never replaces the human approval.

## MCP

`.mcp.json` connects to the official Supabase MCP server, scoped to the shared project in read-only mode. Use it to inspect the schema, logs and advisors. Apply schema changes through migration files and `npm run db:push`, not through MCP.

## Hackathon-day practices

- Hacking is short (see `docs/hackathon-day.md`). Keep PRs small and merge often. Keep `main` demoable at all times.
- Run `npm run preflight` before marking a PR ready.
- Schema changes are additive. Don't rename or drop a column a teammate might be using.
- Keep the `/dev` pages until the end. They are the fastest way to tell whether a problem is in the infrastructure or in your feature.
- Before any commit of secrets-adjacent work, run `npm run secrets:scan`.
- Report honestly: don't say a check passed unless it ran and passed. Hosted tests skip without credentials, and a skip is not a pass.

# Hosted Supabase setup (migration owner)

Teammates don't need any of this. They only need the shared URL and publishable key.

This all runs without Docker. Supabase CLI v3 targets a local stack by default, so hosted commands need `--remote`. The `npm run db:*` scripts add it for you.

## 1. Create the project (free plan)

Skip this if the shared project already exists.

Use a dedicated project on a **free-plan organisation**, in the region closest to the venue (`eu-west-2`, London). A free organisation allows 2 active projects, and paused projects don't count. Never upgrade the organisation or enable add-ons or branching for this.

## 2. Sign the CLI in and link it

The login uses the official browser flow. If it shows a code, enter it in the terminal, and never paste it into chat.

```bash
npx supabase login
```

```bash
npx supabase link <project-ref>
```

## 3. Apply migrations

Preview first, then apply. The push asks for confirmation.

```bash
npm run db:plan
```

```bash
npm run db:push
```

```bash
npm run db:types
```

Commit the regenerated `src/lib/supabase/database.types.ts`. Run `npm run db:status` at any time to compare local files with the hosted history.

`db:push` refuses to run unless you are the owner listed in `supabase/MIGRATION_OWNER`, you are on `main`, and `main` matches `origin/main`. For the very first bootstrap only, before the repo is on GitHub, add `-- --skip-git-checks`.

## 4. Configure authentication

**Turn off email confirmation.** This is the most important setting for a reliable demo. Supabase's built-in mailer only sends to members of your organisation, at about 2 messages an hour. With confirmation on, sign-ups from anyone else fail with "Email address not authorized".

In the dashboard, go to **Authentication > Sign In / Providers > Email** and turn off **Confirm email**.

Also set these under **Authentication > URL Configuration**:

- **Site URL:** `http://localhost:3000`, or your deployed URL
- **Redirect URLs:** `http://localhost:3000/**`, plus your deployed URL with `/**`

The same values are recorded in `supabase/config.toml`. If you prefer to apply them from there, review the differences first, because `config push` applies that file's auth settings to the hosted project:

```bash
npx supabase config push --remote
```

If email is truly needed later, connect a free custom SMTP provider (see [optional-patterns.md](optional-patterns.md)).

## 5. Share the client values

This prints only the Project URL and publishable key, ready to paste into a teammate's `.env.local`. Both are safe to share:

```bash
npm run env:share
```

**Never share the secret key.** It bypasses RLS and is for the owner's machine only.

**Don't run `npx supabase projects api-keys` directly.** Even without `--reveal`, CLI 3.0.0 prints the legacy `service_role` key in full, which would put it in your terminal history or an AI session's transcript. The npm scripts capture that output and print nothing secret. If it's ever exposed, rotate the project's keys.

## 6. Run the hosted tests

These need only the public URL and publishable key, so no privileged key is involved. This writes `.env.test.local`, which is gitignored:

```bash
npm run env:test
```

A teammate without Supabase access can create that file by hand instead, with `SUPABASE_TEST_URL` and `SUPABASE_TEST_PUBLISHABLE_KEY` set to the shared values.

```bash
npm run test:integration
```

```bash
npm run test:e2e
```

Tests sign up disposable users such as `guh-test+<uuid>@example.test`, and remove the rows and files those users own. The empty accounts stay until the owner clears them, and they hold no data:

```bash
npm run db:sweep-tests
```

Sign-ups and sign-ins share a limit of 30 per 5 minutes per IP. The integration and E2E suites use about 25 between them, so leave a few minutes between full runs.

**Optional, owner only:** this adds the secret key to `.env.test.local`, which removes test accounts automatically and enables two admin-only checks. Only do this on a machine you trust, and never with an AI assistant's session sharing the terminal:

```bash
npm run env:test -- --with-secret
```

## 7. Connect the MCP server

`.mcp.json` points Claude Code at the official Supabase MCP server, scoped to this project and read-only. Each person who wants it needs to be a member of the Supabase organisation and signs in through their own browser. In a terminal, run `claude`, then type `/mcp`, choose `supabase`, and authenticate. No personal access token is needed.

The bundled Supabase Claude Code plugin is optional and not installed here, because its MCP server isn't scoped to this project.

## 8. Run the security audit

This is read-only, so it's safe to run at any time:

```bash
npm run db:audit
```

It lists any public table without RLS or policies, any privilege held by `anon`, any `SECURITY DEFINER` function in `public`, and any public or unlimited bucket. It then shows Supabase's security advisors. Any row in the first part is a problem to fix.

## Removing the smoke-test objects

Keep these until the end of the event, because they power `/dev` and the tests. To remove them afterwards:

1. Delete `src/features/dev-smoke`, `src/app/dev`, `e2e/hosted.spec.ts` and `tests/integration`.
2. Run `npm run db:new -- drop_dev_smoke`, and write:

```sql
-- migration-allow: destructive removing the infrastructure smoke test
alter publication supabase_realtime drop table public.dev_smoke_records;
drop table public.dev_smoke_records;
```

3. Empty the `dev-smoke-private` bucket from the dashboard, and delete it there.

## Safety rules

- Never run `supabase db reset --remote`.
- Never use `--include-seed` on the shared project.
- Never enable branching or add-ons, because they can bill.
- If a secret key is ever exposed, rotate it immediately under **Project Settings > API Keys**.

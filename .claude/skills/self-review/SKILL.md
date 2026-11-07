---
name: self-review
description: GUH2026's pre-PR self-review. Resolves the real branch diff (including new untracked files), runs the built-in /code-review for generic correctness, applies the GUH2026 lenses (auth, RLS, migrations, keys, limits, free plan, tests, CI), grades findings Critical, Important or Suggestion, and records the marker that lets `gh pr ready` through the git guard. Load before marking a PR ready, when asked to review a diff, branch or PR, and before calling any change done. Triggers on review, self-review, check my diff, ready for review, ready to merge, code review.
---

# GUH2026 self-review

This is Claude's own review, done **before** a human sees the PR. It never
replaces the one required human approval on GitHub, and it never approves or
merges anything.

## Step 0: resolve the scope, and fail loudly

```bash
git fetch origin main
```

```bash
git merge-base origin/main HEAD
```

If the merge base doesn't resolve, **stop and say so**. An empty diff against an
unresolved base is not a clean branch. Then, with `<base>` from above:

```bash
git diff --stat <base>
```

```bash
git ls-files --others --exclude-standard
```

```bash
git log --format='%h %s' <base>..HEAD
```

The scope is everything in `git diff <base>` (committed and uncommitted) **plus
every untracked file listed**, because `git diff` doesn't show new untracked
files. Read every changed and new file. If the diff is over about 1,000 lines,
say so, and suggest splitting the PR.

## Step 1: send-back checks

Fix these first, because they change everything below:

- **Scope.** Does the PR do one thing? Flag unrelated refactors, formatting churn
  or a second feature riding along.
- **Duplication.** For any new capability (an API route, an external call, a
  table, a hook), search for an existing one yourself:
  `git grep -n -i -E "<term1>|<term2>" -- src scripts`. Report the existing owner
  with `file:line`, or that you found none and which terms you used.
- **Intent.** Would a reviewer know **why** from the commits and description?

## Step 2: generic correctness

Run the built-in `/code-review` over the same diff, at `medium` for a diff under
about 200 lines and `high` otherwise. Fold its findings into the output below
rather than repeating its work by hand.

## Step 3: GUH2026 lenses

Apply each lens whose signal appears in the diff, and report each one as **ran**
or **skipped: reason**. A silent skip reads as coverage.

| Signal in the diff | Check |
| --- | --- |
| Always | **Correctness and edge cases:** empty, signed out, another user's data, errors, concurrency. **TypeScript safety:** no `any`, no `as` hiding a real mismatch, no `!` on external data, no `@ts-ignore`. **Complexity:** the simplest thing that works, matching existing patterns |
| `src/app/**`, `src/proxy.ts`, `actions.ts`, `src/lib/supabase/**` | **Auth and authorization:** `requireUser()`/`getCurrentUser()` on every protected path, zod on every Server Action input, `safeRedirectPath()` for redirects, `createAdminClient()` only with its own authorization check, no raw database or auth errors shown to users (`toDbError`, `friendlyAuthError`) |
| `supabase/migrations/**` | **RLS and migration safety:** additive only, `enable row level security`, explicit grants, policies `to authenticated` using `(select auth.uid())`, nothing granted to `anon`, no unsafe `SECURITY DEFINER`, private buckets with limits, a timestamp newer than every applied migration, `npm run db:lint` passes, and the PR tells the migration owner to apply it |
| `"use client"`, `NEXT_PUBLIC_`, `.env*`, `src/lib/integrations/**`, `src/lib/ai/**` | **Keys:** only the publishable key reaches the browser, secrets are read in `server-only` modules, external calls go through `createApiClient`, and `npm run check:bundle` and `npm run secrets:scan` pass |
| External calls, AI, uploads, new routes | **Resource limits and errors:** timeouts, rate limits and budgets, upload size and type checks, failures mapped to friendly messages, and nothing in tests that spends money or calls a live API |
| `repository.ts`, queries, `useTableChanges`, Realtime, polling | **Free plan and performance:** select only needed columns, `toPageRange` on every list, no polling, one filtered channel per component, no N+1 queries, no heavy client bundles |
| `.github/**`, `.claude/**`, `scripts/**`, `package.json` | **Tooling:** `npm run check:workflows` passes, actions pinned to SHAs, least permissions, no secrets in the PR job, no container runtime in CI, `local:*` scripts never pass `--remote`, hook tests updated, dependencies pinned exactly and justified |
| Any behaviour change | **Regression coverage:** a test that would fail without the change, for a bug fix one that was seen failing first, hosted tests using only disposable users, unit tests without network |
| Any of the above | **Architecture:** features in `src/features/<x>/`, thin routes, shared UI from `src/components/ui/`, conventions in `CLAUDE.md` |

## Step 4: output

Cite `file:line`. Leave out empty sections. Never pad.

```
## Self-review: <branch> (<short HEAD>, <N> files, <M> lines)
Lenses: <each: ran | skipped: reason>. Duplication search: <terms | n/a>.

### Critical      (security hole, data loss, broken main, leaked secret: fix now)
- file:line - summary
  Why it breaks, and the fix.
### Important     (a real bug, a missing test for changed behaviour, a convention CLAUDE.md requires)
### Suggestion    (worth considering; doesn't block)
### Not verified  (what you couldn't check, and why)
```

If nothing fires, say `No findings.`

## Step 5: fix, verify, record

1. Fix every **Critical** and **Important** finding. Re-run the affected tests,
   then review the new diff again. Suggestions don't block.
2. Commit everything. The marker covers committed work only, because that's what
   the PR contains.
3. When no Critical or Important finding is left, record it:

```bash
node .claude/hooks/review-mark.mjs "<one line: what was reviewed and fixed>"
```

4. Push, then `gh pr ready`. Any later commit invalidates the marker, so review
   again before marking ready again.

Never write `.claude/review/last-review.json` by hand, and never use
`SKIP_GIT_GUARD=1` unless the user asks for it.

Finish by listing the checks a human reviewer should try themselves: the pages to
open, what to click, and what to expect, grounded in this diff.

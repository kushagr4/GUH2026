---
name: feature-dev
description: GUH2026's feature workflow - discovery, codebase exploration, a simple design, implementation with tests on a feature branch, verification, /self-review, and a draft PR handed to one human reviewer. Load BEFORE writing code for any new feature, behaviour change or refactor. Triggers on add, build, implement, create, change, extend, refactor, wire up, support, or any request to make the app do something it doesn't do yet. For a bug, use /bugfix instead.
---

# Feature development in GUH2026

Seven phases, scaled to the size of the change. The rules in `CLAUDE.md` (no
Docker, one shared free-plan Supabase project, migrations through the owner,
keys server-side, RLS everywhere) apply throughout. Track the phases with the
task list.

## Size it first

| Size | Example | Explore | Design | Review |
| --- | --- | --- | --- | --- |
| **Trivial** | Copy change, a style tweak, one obvious line | Read the file | None | `/self-review` |
| **Small** | A form field, a new list on an existing page | Read the nearest example yourself | A few lines in chat | `/self-review` |
| **Large** | A new feature folder, a migration, a new external API | 2 `code-explorer` agents in parallel | 1 or 2 `code-architect` agents | `/self-review`, plus a `code-reviewer` agent for the riskiest area |

Never launch three agents for a trivial change. When in doubt, go one size down
and step up if you find surprises.

## Phase 1: Discovery

1. Restate the request as an objective, with **acceptance criteria**: observable
   behaviour a reviewer can check ("a signed-in user sees only their own polls").
2. Note dependencies: a table that doesn't exist yet, an integration key, another
   teammate's open PR.
3. List edge cases: empty, signed out, another user's data, slow network, limits.
4. Ask only **genuinely blocking** questions, all at once, then wait. If a
   sensible default exists, state it and carry on. It's a 6-hour hackathon.

## Phase 2: Codebase exploration

Find what already exists before writing anything new:

- The reference feature is `src/features/account/` (repository, actions,
  components). Pages live in `src/app/app/<feature>/`.
- Shared building blocks: `src/components/ui/` (shadcn), `src/lib/db/`
  (`DbResult`, `toPageRange`), `src/lib/storage/`, `src/lib/realtime/`,
  `src/lib/ai/`, `src/lib/integrations/` (`createApiClient`).
- Search for the **capability**, not your planned names:
  `git grep -n -i -E "<term1>|<term2>" -- src`. Report the existing owner with
  `file:line`, or say you searched and what terms you used.
- Look at the tests next to similar code (`tests/unit/`, `e2e/`) so yours match.

For a large change, launch two `code-explorer` agents with different briefs (the
closest existing feature; the architecture and tests of the area), then **read
the files they name** yourself.

## Phase 3: Implementation design

- Pick the **simplest maintainable approach** that fits the existing patterns.
- List the files to create or change, any data model change, and the tests.
- **Migration?** It needs `npm run db:new -- <name>`, RLS, explicit grants and
  owner policies in the same file, and the migration owner to apply it after
  merge. Additive only. Say so up front: it's the slowest part.
- Record trade-offs in a sentence or two. They go in the PR description.
- For a large change, a `code-architect` agent can draft the blueprint. Choose
  one approach and say why. Don't present a menu unless the user must choose.

## Phase 4: Implementation

1. Work on a branch: `feat/<issue>-<short-name>`, or `feat/<short-name>` with no
   issue. Never on `main`.
2. Follow the architecture: Server Components by default, Server Actions with
   zod and typed results, repositories taking a client and returning `DbResult`,
   `requireUser()` for auth, paginated queries, no raw errors to users.
3. Keep the diff focused on the objective. No drive-by refactors or formatting.
4. **Write tests alongside the code**: unit tests in `tests/unit/` for logic,
   an E2E step in `e2e/hosted.spec.ts` for a user journey that needs the backend.
5. Commit in small Conventional Commits: `feat(polls): add the voting form`.
6. Push and open a **draft** PR early, so teammates can see it:
   `gh pr create --draft --fill`.

## Phase 5: Verification

1. Run the relevant unit tests, then `npm run preflight` (what CI runs).
2. Exercise the behaviour for real: `npm run dev`, sign in, and walk through the
   acceptance criteria. For hosted behaviour, use `/dev` and the hosted E2E tests.
3. Check each acceptance criterion and write down how you checked it. A
   compiling build is not verification.
4. Report honestly: a skipped check is a skip, not a pass.

## Phase 6: Code review

Run **`/self-review`**. It reviews the actual branch diff, including new files,
with the GUH2026 lenses, and grades findings Critical, Important or Suggestion.
Fix every Critical and Important finding, re-run the affected tests, and re-run
`/self-review` until none is left. It then records a marker that lets
`gh pr ready` through the git guard.

Self-review never replaces the human approval. It makes that review faster.

## Phase 7: PR handoff

1. Push, then fill in the PR template: objective or issue (`Closes #12`),
   summary, approach, acceptance criteria, tests, verification results,
   screenshots for UI, migration notes, security notes, known limitations.
2. Mark it ready: `gh pr ready`.
3. Request one human reviewer who isn't the author:
   `gh pr edit --add-reviewer <login>`.
4. Confirm the **PR Checks** run is green and link it.
5. **Stop.** Never merge, never approve, never push to `main`. The reviewer or
   owner merges after approving. If the reviewer asks for changes, fix them in
   new commits on the same branch, re-run `/self-review`, and reply to each comment.

Finish with: what was built, the files touched, how each acceptance criterion
was verified, the PR link, the CI run link, and anything not verified.

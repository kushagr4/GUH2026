# CI and reviews

Every change reaches `main` through a pull request that passes **PR Checks** and
has **one approval from someone other than its author**. This page covers what
CI runs, how to read a failure, and how much of the review rule GitHub actually
enforces on this repo.

## PR Checks

One workflow, [`.github/workflows/ci.yml`](../.github/workflows/ci.yml), with
one job called **PR Checks**: one checkout, one `npm ci`, then every check in
order. A failed check doesn't stop the others, so one run lists everything to
fix, and the job fails if any check failed.

| Step | Blocks the PR? | Run it locally |
| --- | --- | --- |
| Validate PR title (Conventional Commits) | Yes. It becomes the squash commit on `main` | `node scripts/check-commits.mjs --title "feat(x): y"` |
| Check commit messages | No, warnings only. Squash-merging replaces them | `npm run check:commits` |
| Validate workflow files | Yes | `npm run check:workflows` |
| ESLint | Yes | `npm run lint` |
| TypeScript | Yes | `npm run typecheck` |
| Unit tests | Yes | `npm test` |
| Migration lint | Yes | `npm run db:lint` |
| Secret scan (files and history) | Yes | `npm run secrets:scan` |
| Production build | Yes | `npm run build` |
| Client bundle scan | Yes | `npm run check:bundle` |
| Playwright smoke tests (no Supabase) | Yes | `npx playwright test e2e/smoke.spec.ts` |

`npm run preflight` runs all of these in the same order and prints a summary.
`npm run validate` is the same minus the commit checks and the browser tests.

**When it runs:** on PRs to `main` when opened, pushed to, reopened or edited
(a title change re-runs it), on every push to `main`, and by hand from the
Actions tab. A newer push cancels a PR's older run.

**Limits:**
- It needs no secrets: the build uses placeholder Supabase values.
- It has read-only repository access and a 15-minute timeout.
- It never deploys.
- A run takes about 2 minutes, of which `npm ci` is about 45 seconds.

**Why the smoke tests stay in the PR job:** the browser install and tests add
about 30 seconds. They are the only check before merge that `/dev` stays hidden
in production, that protected pages redirect to sign-in, and that the security
headers are set. Moving them after merge would save 30 seconds and let those
regressions reach `main`.

### Hosted tests (opt-in)

The hosted integration and E2E tests use the **shared** free-plan Supabase
project and its auth rate limit, so they **never run on pull requests**. They
run only:

- **By hand:** Actions → CI → Run workflow, with "Also run the hosted tests" ticked.
- **After merge:** on pushes to `main`, if the repository variable `RUN_HOSTED_TESTS` is `true`.

Both need the `SUPABASE_TEST_URL` and `SUPABASE_TEST_PUBLISHABLE_KEY` Actions
secrets, which are public values. Locally, anyone can run them with
`.env.test.local` (see [supabase-setup.md](supabase-setup.md)).

### When CI fails

1. Open the failed run from the PR, and find the step with the red cross. Or
   run `gh run view --log-failed`.
2. Run the matching local command from the table, and fix it there.
3. Push the fix to the same branch. CI re-runs by itself. For a bad title, edit
   the title on GitHub.
4. Don't skip, disable or weaken a check to get green. If a check itself is
   wrong, fix it in its own small PR. Follow [debugging-workflow.md](debugging-workflow.md).

## The review rule

**One approving review from someone other than the author, on the latest
commit, before merging.** Approvals of older commits don't count, requested
changes must be resolved, and review conversations should be resolved.

### What GitHub enforces here: nothing, on the current plan

This is a **private repository on a personal GitHub Free account**. GitHub's API
refuses both branch protection and rulesets for it:

> Upgrade to GitHub Pro or make this repository public to enable this feature.

(`GET /repos/kushagr4/GUH2026/rulesets` and `.../branches/main/protection`,
checked on 7 November 2026.)

So today, **anyone with write access can merge an unapproved PR or push straight
to `main`.** The repo doesn't upgrade or go public to fix this. The rule is
upheld by:

| Measure | What it does | Limit |
| --- | --- | --- |
| **Human review** status ([`review-status.yml`](../.github/workflows/review-status.yml)) | Pending until someone other than the author approves the latest commit; red while changes are requested; green once approved | Advisory. The Merge button still works. Conversations aren't tracked, because GitHub can't trigger a workflow when one is resolved |
| PR template reviewer checklist | Reminds the reviewer what to check | A checklist, not a gate |
| [`CODEOWNERS`](../.github/CODEOWNERS) | Names who reviews what | Whether it auto-requests reviewers on this plan isn't verified. Request one by hand |
| Claude Code git guard (`.claude/hooks/git-guard.mjs`) | Claude can't merge, approve or push to `main`, and can't mark a PR ready before `/self-review` passes | Guards Claude only, not people |
| GitHub itself | An author can never approve their own PR | Always on |

**Before merging, the person merging checks that the Human review status is
green.** If it isn't, don't merge.

### Turning on real enforcement

If the repo moves to a plan that supports it (GitHub Pro for a personal account,
or an organisation on GitHub Team), or becomes public, the owner applies the
ready-made ruleset in one command:

```bash
gh api --method POST repos/kushagr4/GUH2026/rulesets --input .github/rulesets/protect-main.json
```

[`.github/rulesets/protect-main.json`](../.github/rulesets/protect-main.json) applies to `main`. It:

- requires a pull request with 1 approving review
- dismisses stale approvals when new commits are pushed
- requires approval of the most recent push, so whoever pushed last can't approve it
- requires review conversations to be resolved
- requires the **PR Checks** status check, from GitHub Actions
- allows only squash merges
- blocks force pushes and deletion
- has no bypass list, so nobody, admins included, can skip it

The same settings in the web UI are under Settings → Rules → Rulesets → New
branch ruleset. Make sure "Bypass list" is empty, and target `main`.

Because of "most recent push", don't push commits to a teammate's PR branch:
suggest the change in a review comment instead, or you can't approve it.

This file hasn't been tested against the API, because the API refuses rulesets
on the current plan. After applying it, **verify enforcement**. Open a test PR,
and confirm GitHub blocks merging it without an approval:
`gh pr view <n> --json mergeStateStatus` should say `BLOCKED`. Then close the PR
without merging. Until that check passes, treat the rule as advisory.

### Merging

- **Squash and merge**, so `main` gets one commit per PR, titled with the PR's Conventional Commit title.
- **The reviewer, or the repository owner, merges**, after approval. Claude Code never merges or approves.
- After merging, delete the branch. If the PR had a migration, the migration owner applies it ([team-workflow.md](team-workflow.md)).

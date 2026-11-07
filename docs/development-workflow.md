# Development workflow

How every change gets from an idea to `main`: a focused branch, a draft PR,
green **PR Checks**, and one approval from a teammate. `main` stays demoable at
all times.

## The short version

```bash
git switch main
```

```bash
git pull
```

```bash
git switch -c feat/12-poll-voting
```

Build it, with tests. Commit with titles like `feat(polls): add the voting form`.

```bash
git push -u origin HEAD
```

```bash
gh pr create --draft --fill
```

When it's done and reviewed, run `npm run preflight`, then:

```bash
gh pr ready
```

```bash
gh pr edit --add-reviewer <teammate>
```

A teammate approves, PR Checks is green, and the reviewer or the repository
owner squash-merges it.

## 1. Start a branch

| Kind | Branch | PR title |
| --- | --- | --- |
| Feature | `feat/<issue>-<short-name>` | `feat(polls): add voting` |
| Bug fix | `fix/<issue>-<short-name>` | `fix(auth): keep the session after reload` |
| Refactor | `refactor/<issue>-<short-name>` | `refactor(db): share the pagination helper` |
| Anything else | `chore/<short-name>` | `chore(deps): bump next` |

- **GitHub Issues are the tickets.** Create one for anything that takes more than an hour or that someone else may pick up, and put its number in the branch name.
- **No issue?** Drop the number: `feat/poll-voting`.
- **One branch per change**, cut from an up-to-date `main`. Keep it to one thing a reviewer can understand in a few minutes. Split anything bigger.

**Commit titles** follow [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): description`.

- Types: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `chore`, `ci`, `build`, `style` and `revert`.
- Scopes are optional, lowercase names such as `auth`, `db`, `ui`, `realtime`, `storage`, `ai`, `integrations`, `ci` or `docs`.
- Start the description in lowercase, and don't end it with a full stop.

Only the **PR title** is enforced, because it becomes the squash commit on `main`.

## 2. Build a feature with Claude Code

Ask for the feature in plain words. Claude Code follows `/feature-dev`
([`.claude/skills/feature-dev/SKILL.md`](../.claude/skills/feature-dev/SKILL.md)):

1. **Discovery.** It agrees acceptance criteria, and asks only blocking questions.
2. **Exploration.** It finds existing patterns to reuse. `src/features/account/` is the reference feature.
3. **Design.** It picks the simplest approach, and flags any migration early.
4. **Implementation.** It works on a feature branch, with tests next to the code.
5. **Verification.** It runs `npm run preflight`, and tries the app for real.
6. **Review.** It runs `/self-review`, and fixes Critical and Important findings.
7. **Handoff.** It opens the PR, marks it ready, and requests your reviewer.

A trivial change skips most of this. A large one uses helper agents for
exploration and design. You can also type `/feature-dev <request>` directly.

**Claude never merges, approves, or pushes to `main`.** A local hook enforces
that for Claude (see [ci-and-reviews.md](ci-and-reviews.md)).

## 3. Fix a bug

Follow [debugging-workflow.md](debugging-workflow.md), or ask Claude Code, which
uses `/bugfix`. In short: reproduce, find the root cause, write a test that
fails, make the smallest fix, show the test passing, and open a `fix/` PR that
explains the cause.

## 4. Run the preflight

```bash
npm run preflight
```

This runs what CI's PR Checks runs, in the same order, and ends with a summary.
It needs no Supabase credentials and spends nothing.

- `npm run preflight -- --no-e2e` skips the browser tests, if Chromium isn't installed (`npx playwright install chromium`).
- `npm run preflight -- --title "feat(x): y"` also checks the title you plan to use.

## 5. Open a draft PR

Open the PR as a **draft** as soon as there's something to show. Teammates can
see what's in progress, and CI starts checking early.

```bash
gh pr create --draft --fill
```

Fill in the template as the work takes shape:

- the objective, and `Closes #12` if there's an issue
- acceptance criteria, tests, and what you verified
- screenshots, for UI changes
- the migration and security sections

Mark it ready only when the work, the tests and the self-review are done:

```bash
gh pr ready
```

## 6. Request a reviewer

Pick a teammate who didn't write the code:

```bash
gh pr edit --add-reviewer <login>
```

Or use **Reviewers** on the PR page. Tell them in the team chat, because
hackathon reviews need to be fast. A teammate's migration also needs the
migration owner ([team-workflow.md](team-workflow.md)).

**As the reviewer:**

- Pull the branch, or read the diff, and try the risky part yourself.
- Work through the template's reviewer checklist.
- Then **Approve**, or **Request changes** with concrete comments. Aim for 15 minutes from request to verdict.

## 7. Respond to review feedback

- Fix each point in **new commits** on the same branch. Don't force-push over a review in progress.
- Reply to each comment with what you changed, and let the reviewer resolve their own threads.
- Re-run `npm run preflight`, push, and re-request review. Any new commit makes an earlier approval stale.

## 8. Check CI

The PR page shows two statuses:

- **PR Checks** must be green before merging.
- **Human review** shows whether someone else has approved the latest commit.

If PR Checks fails, open it, find the red step, and fix it locally with the
command listed in [ci-and-reviews.md](ci-and-reviews.md#when-ci-fails).

## 9. Merge after approval

Merge only when **PR Checks is green, Human review is green, and every
conversation is resolved**. The reviewer, or the repository owner, merges:

- Use **Squash and merge**.
- Delete the branch.

If the PR had a migration, the migration owner then applies it.

GitHub doesn't block an unapproved merge on this repo's plan, so this step is on
trust. See [ci-and-reviews.md](ci-and-reviews.md#the-review-rule).

## 10. Recover from a red CI or a rejected review

| Situation | What to do |
| --- | --- |
| A check fails | Reproduce it locally with the matching command, fix it, and push. Never disable or weaken the check |
| Only the PR title fails | Edit the title on GitHub. CI re-runs by itself |
| It passes locally but fails in CI | Compare Node versions (`.nvmrc`). Run `npm ci` to match the lockfile, then `npm run preflight` |
| The branch is behind `main`, or has conflicts | `git merge origin/main`, fix the conflicts, run the preflight, and push |
| **Changes requested** | Treat each comment as a task. Fix it, reply, push, and re-request review |
| The approach was rejected | Agree the new approach in a comment first. If it's a rewrite, close the PR and start a fresh branch |
| A bad change already reached `main` | Open a `revert` PR (`git revert <sha>`) and get it approved like any other. Database changes need a forward migration, because there's no reset |

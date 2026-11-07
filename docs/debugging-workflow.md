# Debugging workflow

For any bug that isn't a one-character typo. Claude Code follows the same steps
in `/bugfix` ([`.claude/skills/bugfix/SKILL.md`](../.claude/skills/bugfix/SKILL.md)).

**A bug is fixed when a test that failed before now passes, and the original
symptom is gone.** "It compiles" isn't a fix.

## 1. Reproduce

Write down the exact error, the page or command, the account, and what you
expected. Then make it happen again yourself:

- **In the app:** run `npm run dev` and repeat the steps.
- **In a test:** `npx vitest run tests/unit/<file>`, or `npx playwright test e2e/<file>`.
- **In CI:** `gh run view <run-id> --log-failed`.

If you can't reproduce it, collect more evidence before changing code.

## 2. Investigate

- **Backend or code?** Open `/dev`, or run `npm run health`. If the shared project is down or paused, it's not your code.
- Read the failing path end to end: the page, the action, the repository and the policy.
- Check the browser console, the dev server output, and the Supabase logs.
- Check recent changes with `git log -p <file>`. If it used to work, use `git bisect`.

Keep two lists: what you **observed**, and what you **suspect**. Change code
only on observed evidence.

## 3. Isolate

Name the root cause in one sentence, with the file and line, before fixing
anything. Confirm it with a log line or a tiny experiment, then remove that
experiment.

## 4. Write a regression test

Write a test that shows the bug, and **run it before the fix to see it fail.**

- Logic goes in `tests/unit/`.
- A user journey goes in `e2e/`.
- A hosted test that needs the backend goes in `tests/integration/` or `e2e/hosted.spec.ts`, using disposable test users only.

## 5. Fix

Make the smallest change that fixes the root cause.

- **Never weaken security to make it work.** No looser RLS, no grants to `anon`, no admin client to dodge a policy, no secret in client code.
- **Never hide the symptom.** No swallowed errors, skipped tests, `@ts-ignore` or `eslint-disable`.
- **A database bug needs a forward migration** through the migration owner. There's no reset.

## 6. Verify

Run the regression test, which should now pass, and the tests around the change.

```bash
npm run preflight
```

Then repeat step 1's reproduction, and confirm the symptom is gone. If a
command keeps failing, stop and read why. Don't keep retrying it.

## 7. Review the diff

The diff should contain the fix and its test, and nothing else: no stray logs,
no unrelated changes. Claude Code runs `/self-review` here.

## 8. Submit

- Branch `fix/<issue>-<short-name>`, with a title like `fix(realtime): wait for the authenticated subscription`.
- Open a draft PR, and mark it ready after the review.
- In the description, give the **root cause**, the fix, the test that failed before and passes now, and the reproduction you re-ran.
- Request one reviewer. Never merge your own PR.

### Example

The Realtime fix in commit `655351a`:

- **Symptom:** the browser showed "Live", but no events arrived.
- **Observed:** WebSocket frame logging showed the join carried only the publishable key.
- **Root cause:** `useTableChanges` subscribed before sending the user's token, so RLS treated the subscriber as anonymous.
- **Regression tests:** 4 of the 7 unit tests failed on the old code, and a hosted E2E test showed no `INSERT` event arriving.
- **Fix:** `await supabase.realtime.setAuth()` before joining, plus `wait: true` so "Live" is honest.
- **Verified:** all 7 unit tests pass, and the E2E test sees the event live.

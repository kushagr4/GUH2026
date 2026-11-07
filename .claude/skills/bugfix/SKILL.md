---
name: bugfix
description: GUH2026's structured debugging workflow - reproduce, investigate, isolate the root cause, add a regression test that fails first, apply the smallest fix, verify, and submit a focused fix PR. Load before changing code to fix anything broken. Triggers on bug, broken, error, failing, crash, regression, doesn't work, stopped working, wrong result, flaky, 500, exception, stack trace, CI failure.
---

# Fixing a bug in GUH2026

Never declare a bug fixed because the app compiles. A fix is done when a test
that failed before now passes, and the original symptom is gone in a realistic
environment.

## 1. Reproduce

- Write down the **exact failure**: the error text, the URL or command, the
  user, and the expected versus actual result.
- Reproduce it yourself before changing anything: `npm run dev` and the steps,
  the failing test (`npx vitest run <file>`, `npx playwright test <file>`), or
  the failing CI step's log (`gh run view <id> --log-failed`).
- If you can't reproduce it, say so, and gather more evidence rather than
  guessing at a fix.

## 2. Investigate

- Read the failing code path end to end, the related tests and the config.
- Use the evidence the repo gives you: `/dev` diagnostics (is it the backend or
  the code?), `npm run health`, server logs, the browser console, and the
  Supabase logs and advisors through the read-only MCP.
- Keep two lists, **observed** (seen in a log, a test or a reproduction) and
  **hypotheses** (not yet proven). Only observed facts justify a change.
- Check recent history: `git log -p --follow <file>`, or `git bisect` for a
  regression with a known good commit.

## 3. Isolate

- Name the root cause in one sentence, with `file:line`, before editing code.
- Confirm it: a log line, a minimal test, or a one-line experiment you revert.
- Don't change unrelated systems speculatively. If the cause is in shared
  infrastructure (the hosted project, an integration's account), stop and tell
  the user rather than working around it.

## 4. Add regression coverage

- Write a test that demonstrates the bug: a unit test for logic, an E2E step for
  a journey.
- **Run it against the unfixed code and watch it fail** for the right reason.
  Note the failure output for the PR. If that isn't feasible (a third-party
  outage, a timing-only bug), say why in the PR.

## 5. Fix

- Make the smallest correct change at the root cause.
- **Never weaken security to make it work**: no RLS policy loosened, no grant to
  `anon`, no `createAdminClient()` to dodge a policy, no secret moved client-side.
- **Never silence the symptom**: no swallowed errors, skipped tests,
  `eslint-disable`, `@ts-ignore`, loosened validation or longer timeouts unless
  the timeout itself was the bug.
- A database bug needs a forward migration through the owner. There's no reset.

## 6. Verify

- Run the regression test (now passing), the tests around the change, then
  `npm run preflight`.
- Re-run the original reproduction from step 1 and confirm the symptom is gone.
- If a command keeps failing, stop retrying and read why it failed.

## 7. Quick handoff check

Confirm the failing regression now passes and the relevant diff contains only the bug fix. Do not invoke /self-review or launch a reviewer agent unless explicitly requested. Keep auth, RLS, secrets and irreversible data changes safe.

## 8. Submit

- Branch `fix/<issue>-<short-name>` (or `fix/<short-name>`), and a title like
  `fix(realtime): wait for the authenticated subscription`.
- Open a normal PR with the focused fix and test results. No Claude self-review or teammate approval is required in hackathon mode.
- The description states the **root cause**, the fix, and the evidence: the test
  failing before and passing after, and the reproduction re-run.
- Never merge it yourself.

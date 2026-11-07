<!--
Title: a Conventional Commit, because it becomes the commit on main.
  feat(auth): add social sign-in   ·   fix(realtime): wait for the authenticated subscription
Open as a draft until the work, tests and /self-review are done. Never merge your own PR.
-->

## Objective

<!-- Closes #<issue>, or one sentence on what this is for. -->

## Summary

<!-- What changed, in two or three bullets. -->

## Approach

<!-- How it works, and any trade-off you chose. Skip for a one-liner. -->

## Acceptance criteria

<!-- Observable behaviour a reviewer can check. -->
- [ ]

## Tests

<!-- Tests added or updated. For a bug fix: the test that failed before the fix. -->

## Verification

<!-- What you ran and saw. A skipped check is a skip, not a pass. -->
- [ ] `npm run preflight` passes, or say what was skipped and why
- [ ] Tried it for real: <!-- pages, steps and results -->

## Screenshots

<!-- For visible UI changes. Otherwise "n/a". -->

## Database migration

- [ ] No migration
- [ ] Includes a migration: additive only, RLS with explicit grants and owner policies, `npm run db:lint` passes, and the migration owner will apply it after merge

## Security

<!-- Auth checks, RLS, keys kept server-side, limits, new external calls. Or "No security impact". -->

## Known limitations

<!-- What's not done, not verified or deliberately left out. -->

## Reviewer checklist

- [ ] The change does what the objective says, and nothing unrelated
- [ ] Tests cover the new behaviour, and CI's **PR Checks** is green
- [ ] No secrets, no service-role or secret keys in client code, and RLS isn't weakened
- [ ] I'm not the author, and I tried the risky part myself

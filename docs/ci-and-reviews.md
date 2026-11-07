# CI and PR workflow: hackathon fast-build

The team has deliberately removed mandatory **Claude review**, **human PR approval** and the advisory **Human review** status check to keep EmberGap moving toward a working demo. PRs still provide branch isolation and give the human owner an explicit merge decision. `main` should stay demoable.

## Automated PR Checks

`.github/workflows/ci.yml` runs **PR Checks** when a PR is opened or updated. It checks Conventional Commit titles, workflow files, ESLint, TypeScript, unit tests, migration lint, secrets scanning, production build, client bundle safety and basic Playwright smoke tests.

Run `npm run preflight` before handoff if practical. You may open a normal PR as soon as focused local tests pass; CI can run while you work on another independent task. If CI fails, fix the concrete defect. Never turn off RLS, secrets or hosted database safety rules to get green.

Hosted integration and E2E tests remain opt-in and off the PR workflow because they target the shared free-plan Supabase project. Use `npm run local:test` for relevant database changes.

## No review gate

- No `/self-review` or `/code-review` pass unless the user asks.
- No `review-mark.mjs` marker, teammate approval or required reviewer.
- The retired Human review status workflow is not a merge requirement.
- Open standard, non-draft PRs with a short handoff and test results.
- Claude Code **does not merge, approve or push to `main`**. The human repository owner performs the merge, preferably squash-merging after necessary CI results have completed.

GitHub's private Free-plan branch protections were not enabled in this repo. Do not apply an older ruleset with a one-approval requirement while fast-build mode is active.

## Troubleshooting

Use GitHub Actions or `gh run view --log-failed` to find failures. Fix the smallest defect and push. A skipped check is not a pass. Minimise UI research, unnecessary refactoring and reviewer-agent overhead until the demo works.

See `docs/development-workflow.md` and `docs/embergap-api-ownership.md`.

# Development workflow: EmberGap hackathon fast-build mode

The priority is **a working demo for judges**, not a production-grade product or a review ceremony. Every contributor owns a separate feature branch; keep `main` demoable. Use an ordinary PR so the human repository owner can merge completed work. **Claude self-review, reviewer-agent passes, teammate approval and review-status checks are not required.** Automated tests, secrets scanning and database protections remain.

## Fast path

1. `git status`; `git fetch origin main`. Start from the latest `main`, unless continuing an existing feature branch with uncommitted work.
2. Create or use your assigned branch from `docs/architecture.md`. Do not write to another contributor's paths.
3. Implement the smallest complete demonstrable slice using the shared contracts or clearly labelled synthetic fixtures.
4. Run targeted unit tests, `npm run typecheck`, `npm run lint`, and if relevant `npm run db:lint` and `npm run local:test`. Run `npm run preflight` before demo integration when feasible. **Do not report unrun checks as passing**; CI runs automatically on each PR.
5. Commit with Conventional Commits such as `feat(embergap): add report endpoint` or `fix(agents): reconcile duplicate messages`.
6. Push your feature branch and open a **non-draft PR** with `gh pr create --fill`. Include what works, a quick demo step, known limitations and exact tests run.
7. **Stop at PR handoff.** The human owner merges when necessary CI results are satisfactory. Claude never approves or merges PRs or pushes directly to `main`.

## Removed to accelerate progress

- Mandatory `/self-review` and `/code-review`, as well as reviewer agents.
- `review-mark.mjs` marker before `gh pr create` and `gh pr ready`.
- Approval by a different teammate and advisory Human review status.
- Draft-PR ceremony and waiting for review.

The remaining Git guard deliberately prevents **Claude-originated merges, approvals and direct pushes to main**, not ordinary PR creation. Do not bypass the guard.

## Required correctness

- No unsafe database resets or destructive hosted migrations; only the migration owner applies hosted changes.
- Preserve RLS, authentication, private photo storage, server-only secrets, input validation and API limits.
- Use deterministic synthetic data when live third-party services are unavailable; never fabricate real fire observations.
- Run targeted checks for report creation, agent partitions and idempotent reconciliation.
- Separate ownership across Mac, PC, Danil, Outrolife and d3vmakes as specified in `docs/architecture.md`.

## If CI fails

Read the failure, fix the smallest underlying defect, and push to the same feature branch. Do not disable security checks to force green. If a check is unavailable locally, report the limitation and use CI results. Continue independent tasks while CI runs when safe.

## API ownership

See `docs/embergap-api-ownership.md` for exact upstream services, Next.js route owners, environment keys and deliverables. Share that reference with every contributor before starting.

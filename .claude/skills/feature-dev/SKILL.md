---
name: feature-dev
description: Fast GUH2026 implementation workflow. Implement a focused change on a feature branch, run targeted checks, push and open a PR without mandatory Claude self-review or human approval. For bugs, use /bugfix instead.
---

# EmberGap fast-build feature development

Objective: deliver a functioning, demonstrable end-to-end EmberGap workflow in the limited hackathon window. Read `CLAUDE.md`, `AGENTS.md` and the workstream ownership in `docs/architecture.md` before editing.

1. Inspect `git status`, your current feature branch, the relevant source files and their closest existing patterns. Never overwrite another contributor's changes.
2. Select the smallest useful deliverable in your owned workstream. Write concrete acceptance criteria in a sentence or two. Do not spend time on architecture alternatives, extensive planning, research agents or user studies.
3. Implement directly. Prefer existing Next.js, Supabase, AI and integration utilities. Make synthetic fixtures and a deterministic demo path available where external services may fail.
4. Add **targeted tests for the changed behaviour**, especially auth/RLS, contracts, validation, network partitions and idempotency. Run the relevant test. Never skip secret scanning or knowingly weaken data isolation.
5. Run `npm run typecheck`, `npm run lint` and affected unit tests as you work. Before handoff run `npm run preflight` when feasible. If a long-running check blocks progress, explain which check is still running or skipped and let CI report results; don't claim success.
6. Commit, push your own feature branch and **open a normal (non-draft) PR** using a Conventional Commit title. Include a short what-changed, tests and integration handoff.
7. **Do not invoke `/self-review`, `/code-review`, reviewer agents, `review-mark.mjs`, or request teammate approval** unless explicitly asked. These are not part of hackathon fast-build mode.
8. The human repository owner may merge after checking necessary CI results. Claude Code must not approve, merge or push to `main`. Continue useful work in your owned area rather than waiting for a review.

Safety and quality baseline still applies: no hosted database resets, no secrets in the client, correct RLS, safe uploads and rate limits, provenance-aware wildfire evidence, no automatic emergency claims, and no fabricated measurements. Working and demonstrable is more important than broad polish.

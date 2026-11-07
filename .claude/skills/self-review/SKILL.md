---
name: self-review
description: Optional, explicit-request-only code review for GUH2026. Do NOT load, run, or spawn review agents during routine implementation or PR handoff. Only use if the human explicitly requests a code review or security audit.
---

# Optional code review (not part of hackathon fast-build)

**Do not invoke this skill during ordinary development, PR creation, readiness, or merging.** The team has intentionally removed mandatory Claude review and human review gates to prioritise a working EmberGap demo. No marker or review status is needed, and the old `review-mark.mjs` mechanism has been retired.

Use this skill only if the human **explicitly requests** a review. In that case:

1. Inspect the actual branch diff and relevant tests.
2. Prioritise correctness, auth, RLS, private media handling, secret exposure, untrusted AI outputs, and message reconciliation.
3. Report only actionable, grounded findings with file paths and concise fixes.
4. Run requested or relevant targeted checks. Be honest about skipped tests.
5. Do not approve or merge PRs or push to main.

No review-marker files are written. No automatic review agents are launched.

#!/usr/bin/env node
// Posts a "Human review" commit status on a pull request's latest commit, so
// everyone can see at a glance whether someone other than the author has
// approved it. Run by .github/workflows/review-status.yml.
//
// ADVISORY ONLY. On this repo's GitHub plan nothing stops a merge without an
// approval: this status shows the rule, it doesn't enforce it. See
// docs/ci-and-reviews.md.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const STATUS_CONTEXT = "Human review";
const WRITERS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const MAX_DESCRIPTION = 140; // GitHub's limit for a commit status.

const names = (reviews) => reviews.map((review) => `@${review.user.login}`).join(", ");

/**
 * Decides the status from the pull request and its reviews (oldest first, as the
 * API returns them). Mirrors GitHub's own rules for required reviews: only
 * people with write access count, the author can't approve their own work, an
 * approval of an older commit is stale, and a later review replaces an earlier one.
 */
export function decideReviewStatus({ author, headSha, draft, reviews }) {
  const latest = new Map();
  for (const review of reviews) {
    const login = review.user?.login;
    if (!login || login === author || review.user.type === "Bot") continue;
    if (!WRITERS.has(review.author_association)) continue;
    // Comments don't change a reviewer's verdict; a dismissal clears it.
    if (review.state === "APPROVED" || review.state === "CHANGES_REQUESTED") latest.set(login, review);
    else if (review.state === "DISMISSED") latest.delete(login);
  }
  const verdicts = [...latest.values()];
  const changes = verdicts.filter((review) => review.state === "CHANGES_REQUESTED");
  const approvals = verdicts.filter((review) => review.state === "APPROVED");
  const current = approvals.filter((review) => review.commit_id === headSha);
  const stale = approvals.filter((review) => review.commit_id !== headSha);

  if (draft) return { state: "pending", description: "Draft. Mark it ready for review when it's done." };
  if (changes.length) {
    return { state: "failure", description: `Changes requested by ${names(changes)}. Push fixes, then ask for a re-review.` };
  }
  if (current.length) return { state: "success", description: `Approved by ${names(current)}.` };
  if (stale.length) {
    return { state: "pending", description: `${names(stale)} approved an earlier commit. Ask for a re-review.` };
  }
  return { state: "pending", description: `Needs an approving review from someone other than @${author}.` };
}

export function truncate(text, max = MAX_DESCRIPTION) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

async function github(path, { method = "GET", body } = {}) {
  const api = process.env.GITHUB_API_URL ?? "https://api.github.com";
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "guh2026-review-status",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${method} ${path} failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const number = process.env.PR_NUMBER;
  if (!process.env.GITHUB_TOKEN || !repo || !number) {
    console.log("Needs GITHUB_TOKEN, GITHUB_REPOSITORY and PR_NUMBER. It runs in GitHub Actions.");
    process.exit(2);
  }

  const pr = await github(`/repos/${repo}/pulls/${number}`);
  if (pr.state !== "open") {
    console.log(`PR #${number} is ${pr.state}; nothing to report.`);
    return;
  }
  // Oldest first, every page: the latest verdict may be past the first 100.
  const reviews = [];
  for (let page = 1; ; page++) {
    const batch = await github(`/repos/${repo}/pulls/${number}/reviews?per_page=100&page=${page}`);
    reviews.push(...batch);
    if (batch.length < 100) break;
  }
  const status = decideReviewStatus({
    author: pr.user.login,
    headSha: pr.head.sha,
    draft: pr.draft,
    reviews,
  });
  const description = truncate(status.description);

  await github(`/repos/${repo}/statuses/${pr.head.sha}`, {
    method: "POST",
    body: { state: status.state, context: STATUS_CONTEXT, description, target_url: pr.html_url },
  });
  console.log(`${STATUS_CONTEXT}: ${status.state} on ${pr.head.sha.slice(0, 7)}: ${description}`);
  console.log("Advisory: GitHub does not block merging on this plan. A person checks this before merging.");
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

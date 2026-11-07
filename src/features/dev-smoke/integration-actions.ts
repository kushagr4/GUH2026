"use server";

import { z } from "zod";
import { integrationErrorMessage } from "@/lib/integrations/errors";
import { getFirecrawl } from "@/lib/integrations/firecrawl";
import { getGitHub } from "@/lib/integrations/github";
import { createRateLimiter } from "@/lib/rate-limit";
import { assertDevAccess } from "./access";

export type IntegrationCheckResult =
  | { ok: true; lines: string[] }
  | { ok: false; message: string };

// Per user, on top of each client's own outbound limits.
const limiter = createRateLimiter({ limit: 5, windowMs: 60_000 });

async function guard(): Promise<IntegrationCheckResult | null> {
  const user = await assertDevAccess();
  const { allowed, retryAfterSeconds } = limiter.check(user.id);
  return allowed
    ? null
    : { ok: false, message: `Too many checks. Try again in ${retryAfterSeconds} seconds.` };
}

const repoInput = z.string().trim().min(3).max(200);

/** One unauthenticated (or token) request to the GitHub REST API. Free. */
export async function checkGitHub(input: string): Promise<IntegrationCheckResult> {
  const blocked = await guard();
  if (blocked) return blocked;
  const parsed = repoInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Enter a repository as owner/repo." };

  try {
    const repo = await getGitHub().getRepository(parsed.data);
    return {
      ok: true,
      lines: [
        repo.fullName,
        `${repo.stars} stars, ${repo.forks} forks, ${repo.openIssues} open issues`,
        `Language: ${repo.language ?? "none"}. Last push: ${repo.pushedAt ?? "never"}.`,
      ],
    };
  } catch (error) {
    return { ok: false, message: integrationErrorMessage(error) };
  }
}

const urlInput = z.string().trim().min(8).max(2048);

/** One markdown scrape: costs 1 Firecrawl credit. */
export async function checkFirecrawl(url: string): Promise<IntegrationCheckResult> {
  const blocked = await guard();
  if (blocked) return blocked;
  const parsed = urlInput.safeParse(url);
  if (!parsed.success) return { ok: false, message: "Enter a full URL, starting https://." };

  try {
    const page = await getFirecrawl().scrape(parsed.data);
    const preview = (page.markdown ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
    return {
      ok: true,
      lines: [
        page.title ?? "(no title)",
        `Page status: ${page.statusCode ?? "unknown"}. ${page.markdown?.length ?? 0} characters of markdown.`,
        preview ? `${preview}…` : "(no text)",
      ],
    };
  } catch (error) {
    return { ok: false, message: integrationErrorMessage(error) };
  }
}

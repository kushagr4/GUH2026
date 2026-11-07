"use server";

import { z } from "zod";
import { getElevenLabs } from "@/lib/integrations/elevenlabs";
import { integrationErrorMessage } from "@/lib/integrations/errors";
import { getFirecrawl } from "@/lib/integrations/firecrawl";
import { getGitHub } from "@/lib/integrations/github";
import { getN8n } from "@/lib/integrations/n8n";
import { createRateLimiter } from "@/lib/rate-limit";
import { assertDevAccess } from "./access";

export type IntegrationCheckResult =
  | { ok: true; lines: string[]; audioUrl?: string }
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

const speechInput = z.string().trim().min(1).max(200);

/** Speaks a short line: costs about one credit per character, or half with Flash. */
export async function checkElevenLabs(text: string): Promise<IntegrationCheckResult> {
  const blocked = await guard();
  if (blocked) return blocked;
  const parsed = speechInput.safeParse(text);
  if (!parsed.success) return { ok: false, message: "Enter up to 200 characters to speak." };

  try {
    const speech = await getElevenLabs().speak(parsed.data);
    return {
      ok: true,
      lines: [
        "Speech generated",
        `${speech.characters} characters, ${Math.round(speech.audio.byteLength / 1024)} KB of ${speech.contentType}.`,
      ],
      // A data URL keeps the check self-contained. Real features should return
      // audio from a route handler instead (see docs/integrations.md).
      audioUrl: `data:${speech.contentType};base64,${Buffer.from(speech.audio).toString("base64")}`,
    };
  } catch (error) {
    return { ok: false, message: integrationErrorMessage(error) };
  }
}

/** Reads the account's credit balance. Free, but needs a key allowed to read the user. */
export async function checkElevenLabsUsage(): Promise<IntegrationCheckResult> {
  const blocked = await guard();
  if (blocked) return blocked;
  try {
    const usage = await getElevenLabs().getUsage();
    return {
      ok: true,
      lines: [
        `${usage.remaining.toLocaleString("en-GB")} of ${usage.limit.toLocaleString("en-GB")} credits left`,
        `Plan: ${usage.tier ?? "unknown"}. Resets: ${usage.resetsAt ?? "unknown"}.`,
      ],
    };
  } catch (error) {
    return { ok: false, message: integrationErrorMessage(error) };
  }
}

/** Sends one test event to the configured n8n workflow. */
export async function checkN8n(): Promise<IntegrationCheckResult> {
  const blocked = await guard();
  if (blocked) return blocked;
  try {
    // No user data: the check only proves the workflow is reachable.
    const reply = await getN8n().trigger("guh2026.test", { from: "dev/integrations" });
    const preview = JSON.stringify(reply ?? null).slice(0, 240);
    return { ok: true, lines: ["Workflow accepted the event", `Reply: ${preview}`] };
  } catch (error) {
    return { ok: false, message: integrationErrorMessage(error) };
  }
}

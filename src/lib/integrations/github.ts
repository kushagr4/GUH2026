import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { readIntegrationEnv, type EnvSource, type IntegrationStatus } from "./env";
import { IntegrationError } from "./errors";
import { createApiClient, type ApiClient, type ApiClientOptions } from "./http";

/**
 * GitHub REST API. Public data works with no token (60 requests an hour per
 * server IP); GITHUB_API_TOKEN raises that to 5,000. Checked 7 Nov 2026:
 * https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
 *
 * The variable is deliberately not GITHUB_TOKEN, which many developers already
 * export for the gh CLI. The app would otherwise pick up a broad personal token.
 */
const NAME = "GitHub";
export const GITHUB_API_VERSION = "2026-03-10";

export const GITHUB_ENV = {
  token: {
    name: "GITHUB_API_TOKEN",
    required: false,
    pattern: /^(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]+$/,
    hint: "be a GitHub token, starting github_pat_ or ghp_",
  },
  webhookSecret: { name: "GITHUB_WEBHOOK_SECRET", required: false },
} as const;

const repositorySchema = z
  .object({
    full_name: z.string(),
    description: z.string().nullable(),
    html_url: z.string(),
    stargazers_count: z.number(),
    forks_count: z.number(),
    open_issues_count: z.number(),
    language: z.string().nullable(),
    topics: z.array(z.string()).optional(),
    pushed_at: z.string().nullable(),
    archived: z.boolean(),
  })
  .transform((repo) => ({
    fullName: repo.full_name,
    description: repo.description,
    url: repo.html_url,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    openIssues: repo.open_issues_count,
    language: repo.language,
    topics: repo.topics ?? [],
    pushedAt: repo.pushed_at,
    archived: repo.archived,
  }));

export type GitHubRepository = z.infer<typeof repositorySchema>;

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;

/** Accepts "owner/repo" or a github.com URL. */
export function parseRepositoryName(input: string): { owner: string; repo: string } {
  const trimmed = input
    .trim()
    .replace(/^https?:\/\/(?:www\.)?github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
  const [owner, repo, ...rest] = trimmed.split("/");
  if (!owner || !repo || rest.length || !OWNER.test(owner) || !REPO.test(repo)) {
    throw new IntegrationError(NAME, "bad_request", "GitHub: expected owner/repo");
  }
  return { owner, repo };
}

export type GitHubClient = {
  /** Any REST endpoint, with your own response schema. */
  request: ApiClient["request"];
  getRepository(nameOrUrl: string, options?: { signal?: AbortSignal }): Promise<GitHubRepository>;
};

export function createGitHubClient(
  config: { token?: string } & Pick<ApiClientOptions, "fetch" | "sleep">,
): GitHubClient {
  const { token } = config;
  const api = createApiClient({
    integration: NAME,
    baseUrl: "https://api.github.com",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      // GitHub rejects requests without a User-Agent.
      "User-Agent": "guh2026-starter",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    secrets: [token],
    timeoutMs: 10_000,
    // Stay under GitHub's hourly limit, so the app degrades before GitHub blocks it.
    rateLimits: [{ limit: token ? 4000 : 50, windowMs: 60 * 60_000 }],
    maxConcurrent: 10,
    fetch: config.fetch,
    sleep: config.sleep,
  });

  return {
    request: api.request,
    getRepository(nameOrUrl, options = {}) {
      const { owner, repo } = parseRepositoryName(nameOrUrl);
      return api.request({
        path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
        schema: repositorySchema,
        signal: options.signal,
      });
    },
  };
}

let cached: { key: string; client: GitHubClient } | undefined;

/** The shared client. Works without a token, at the lower public rate limit. */
export function getGitHub(env: EnvSource = process.env): GitHubClient {
  const config = readIntegrationEnv(GITHUB_ENV, env);
  if (config.state === "invalid") {
    throw new IntegrationError(NAME, "not_configured", `GitHub is invalid: ${config.reason}`);
  }
  const token = config.state === "ready" ? config.values.token : undefined;
  const key = token ?? "";
  if (cached?.key !== key) cached = { key, client: createGitHubClient({ token }) };
  return cached.client;
}

/**
 * Checks a webhook delivery's X-Hub-Signature-256 header: an HMAC-SHA256 of the
 * raw body, keyed by the webhook secret. Read the body with `await request.text()`
 * and verify before parsing it.
 * https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
 */
export function verifyWebhookSignature(
  rawBody: string | Uint8Array,
  signatureHeader: string | null | undefined,
  secret: string,
): boolean {
  if (!secret || !signatureHeader?.startsWith("sha256=")) return false;
  const expected = Buffer.from(
    `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`,
  );
  const received = Buffer.from(signatureHeader);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function githubStatus(env: EnvSource = process.env): IntegrationStatus {
  const config = readIntegrationEnv(GITHUB_ENV, env);
  const hasToken = config.state === "ready" && !!config.values.token;
  return {
    id: "github",
    name: NAME,
    state: config.state === "invalid" ? "invalid" : "ready",
    detail:
      config.state === "invalid"
        ? config.reason
        : hasToken
          ? "Token is set: 5,000 requests an hour."
          : "Public data only, with no token: 60 requests an hour per server IP.",
    variables: Object.values(GITHUB_ENV).map((spec) => spec.name),
    docs: "https://docs.github.com/en/rest",
  };
}

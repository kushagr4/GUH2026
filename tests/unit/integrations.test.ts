import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { readIntegrationEnv } from "@/lib/integrations/env";
import {
  IntegrationError,
  integrationErrorMessage,
  integrationErrorResponse,
} from "@/lib/integrations/errors";
import {
  checkPageUrl,
  createFirecrawlClient,
  firecrawlStatus,
  getFirecrawl,
} from "@/lib/integrations/firecrawl";
import {
  GITHUB_API_VERSION,
  createGitHubClient,
  githubStatus,
  parseRepositoryName,
  verifyWebhookSignature,
} from "@/lib/integrations/github";
import { createApiClient } from "@/lib/integrations/http";
import { getIntegrationStatuses } from "@/lib/integrations/status";

// Fake keys are assembled at runtime so this file can't trip the secret scanner.
const FIRECRAWL_KEY = ["fc", "-", "0123456789abcdef".repeat(2)].join("");
const GITHUB_KEY = ["github", "_pat_", "A1".repeat(20)].join("");

type Reply = Response | Error | ((init: RequestInit) => Promise<Response>);

function fakeFetch(...replies: Reply[]) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    const reply = replies.shift();
    if (!reply) throw new Error("Unexpected extra fetch");
    if (reply instanceof Error) throw reply;
    return typeof reply === "function" ? reply(init) : reply;
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const hangUntilAborted = (init: RequestInit) =>
  new Promise<Response>((_, reject) =>
    init.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
  );

const sleep = vi.fn(async () => {});
const ok = z.object({ ok: z.literal(true) });

async function caught(promise: Promise<unknown>): Promise<IntegrationError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof IntegrationError) return error;
    throw error;
  }
  throw new Error("Expected an IntegrationError");
}

beforeEach(() => {
  sleep.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("readIntegrationEnv", () => {
  const specs = {
    key: { name: "DEMO_API_KEY", pattern: /^dk-/, hint: "start with dk-" },
    url: { name: "DEMO_URL", required: false, default: "https://api.example.com", url: true },
  } as const;

  it("is off, not broken, when a required variable is missing or a placeholder", () => {
    expect(readIntegrationEnv(specs, {})).toMatchObject({ state: "off" });
    expect(readIntegrationEnv(specs, { DEMO_API_KEY: "your-api-key" })).toMatchObject({
      state: "off",
      reason: expect.stringContaining("placeholder"),
    });
  });

  it("returns values and defaults when everything is valid", () => {
    expect(readIntegrationEnv(specs, { DEMO_API_KEY: "dk-123" })).toEqual({
      state: "ready",
      values: { key: "dk-123", url: "https://api.example.com" },
    });
  });

  it("names a malformed variable without revealing its value", () => {
    const result = readIntegrationEnv(specs, { DEMO_API_KEY: "wrong-secret-value" });
    expect(result).toMatchObject({ state: "invalid", reason: expect.stringContaining("DEMO_API_KEY") });
    expect(JSON.stringify(result)).not.toContain("wrong-secret-value");
  });

  it("refuses a NEXT_PUBLIC_ copy, which would ship the key to browsers", () => {
    const result = readIntegrationEnv(specs, {
      DEMO_API_KEY: "dk-1",
      NEXT_PUBLIC_DEMO_API_KEY: "dk-1",
    });
    expect(result).toMatchObject({ state: "invalid", reason: expect.stringContaining("NEXT_PUBLIC_DEMO_API_KEY") });
  });

  it("requires https URLs, except on localhost", () => {
    expect(readIntegrationEnv(specs, { DEMO_API_KEY: "dk-1", DEMO_URL: "http://example.com" }).state).toBe("invalid");
    expect(readIntegrationEnv(specs, { DEMO_API_KEY: "dk-1", DEMO_URL: "http://localhost:3002" }).state).toBe("ready");
  });

  it("will not define a NEXT_PUBLIC_ integration variable at all", () => {
    expect(() => readIntegrationEnv({ key: { name: "NEXT_PUBLIC_DEMO_KEY" } }, {})).toThrow(/server-only/);
  });
});

describe("integration errors", () => {
  it("map to our own status codes with safe messages and Retry-After", async () => {
    const error = new IntegrationError("Demo", "rate_limited", "Demo: HTTP 429 secret-body", {
      upstreamStatus: 429,
      retryAfterSeconds: 7,
    });
    const response = integrationErrorResponse(error);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("7");
    const body = await response.json();
    expect(body).toEqual({ error: "Demo is busy. Try again in 7 seconds.", kind: "rate_limited" });
  });

  it("treat a rejected key or empty credit as a server problem (503)", () => {
    expect(new IntegrationError("Demo", "unauthorized", "x").status).toBe(503);
    expect(new IntegrationError("Demo", "quota_exceeded", "x").status).toBe(503);
  });

  it("hide unexpected errors behind a generic message", async () => {
    expect(integrationErrorMessage(new Error("database password is hunter2"))).not.toContain("hunter2");
    expect(integrationErrorResponse(new Error("boom")).status).toBe(500);
  });
});

describe("createApiClient", () => {
  const client = (fetch: typeof globalThis.fetch, extra = {}) =>
    createApiClient({ integration: "Demo", baseUrl: "https://api.example.com/", fetch, sleep, ...extra });

  it("sends JSON to the right URL and validates the response", async () => {
    const { fetch, calls } = fakeFetch(json({ ok: true, extra: "dropped" }));
    const result = await client(fetch, { headers: { Authorization: "Bearer k" } }).request({
      method: "POST",
      path: "/v1/things",
      query: { limit: 5, cursor: undefined },
      body: { name: "x" },
      schema: ok,
    });
    expect(result).toEqual({ ok: true });
    expect(calls[0].url).toBe("https://api.example.com/v1/things?limit=5");
    expect(calls[0].init).toMatchObject({
      method: "POST",
      body: '{"name":"x"}',
      cache: "no-store",
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: "Bearer k" },
    });
  });

  it("refuses absolute URLs, so the auth header can't reach another host", async () => {
    const { fetch } = fakeFetch();
    for (const path of ["https://evil.example/x", "//evil.example/x", "v1/relative"]) {
      expect((await caught(client(fetch).request({ path, schema: ok }))).kind).toBe("bad_request");
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports responses that aren't JSON or don't match the schema", async () => {
    const { fetch } = fakeFetch(new Response("<html>"), json({ ok: "yes" }));
    expect((await caught(client(fetch).request({ path: "/a", schema: ok }))).kind).toBe("invalid_response");
    const mismatch = await caught(client(fetch).request({ path: "/a", schema: ok }));
    expect(mismatch.kind).toBe("invalid_response");
    expect(mismatch.message).toContain("ok");
  });

  it.each([
    [400, "bad_request"],
    [401, "unauthorized"],
    [402, "quota_exceeded"],
    [404, "not_found"],
    [422, "bad_request"],
  ] as const)("maps HTTP %i to %s without retrying", async (status, kind) => {
    const { fetch } = fakeFetch(json({ error: "no" }, status));
    const error = await caught(client(fetch).request({ path: "/a", schema: ok }));
    expect(error).toMatchObject({ kind, upstreamStatus: status });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("retries a GET after a 5xx, with backoff", async () => {
    const { fetch } = fakeFetch(json({}, 503), json({ ok: true }));
    await expect(client(fetch).request({ path: "/a", schema: ok })).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it("does not retry a POST by default, so work isn't done or charged twice", async () => {
    const { fetch } = fakeFetch(json({}, 503));
    const error = await caught(client(fetch).request({ method: "POST", path: "/a", schema: ok }));
    expect(error.kind).toBe("upstream");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("honours a short Retry-After on 429", async () => {
    const { fetch } = fakeFetch(json({}, 429, { "retry-after": "1" }), json({ ok: true }));
    await client(fetch).request({ path: "/a", schema: ok });
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it("fails fast with retryAfterSeconds when the wait is long (GitHub-style 403)", async () => {
    const reset = String(Math.floor(Date.now() / 1000) + 600);
    const { fetch } = fakeFetch(
      json({ message: "API rate limit exceeded" }, 403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": reset }),
    );
    const error = await caught(client(fetch).request({ path: "/a", schema: ok }));
    expect(error.kind).toBe("rate_limited");
    expect(error.retryAfterSeconds).toBeGreaterThan(500);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("times out a request that hangs", async () => {
    const { fetch } = fakeFetch(hangUntilAborted);
    const error = await caught(client(fetch, { timeoutMs: 20 }).request({ path: "/a", schema: ok, retry: false }));
    expect(error.kind).toBe("timeout");
    expect(error.status).toBe(504);
  });

  it("reports a caller's cancellation as cancelled, not a timeout", async () => {
    const { fetch } = fakeFetch(hangUntilAborted);
    const controller = new AbortController();
    const pending = client(fetch).request({ path: "/a", schema: ok, signal: controller.signal });
    controller.abort();
    expect((await caught(pending)).kind).toBe("cancelled");
  });

  it("retries network failures for GET", async () => {
    const { fetch } = fakeFetch(new TypeError("fetch failed"), json({ ok: true }));
    await expect(client(fetch).request({ path: "/a", schema: ok })).resolves.toEqual({ ok: true });
  });

  it("stops at its own rate limit without calling the service", async () => {
    const { fetch } = fakeFetch(json({ ok: true }));
    const api = client(fetch, { rateLimits: [{ limit: 1, windowMs: 60_000 }] });
    await api.request({ path: "/a", schema: ok });
    const error = await caught(api.request({ path: "/a", schema: ok }));
    expect(error.kind).toBe("rate_limited");
    expect(error.retryAfterSeconds).toBeGreaterThan(0);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("caps requests in flight; extra requests wait their turn", async () => {
    let release!: () => void;
    const { fetch } = fakeFetch(
      () => new Promise((resolve) => (release = () => resolve(json({ ok: true })))),
      json({ ok: true }),
    );
    const api = client(fetch, { maxConcurrent: 1 });
    const first = api.request({ path: "/a", schema: ok });
    const second = api.request({ path: "/b", schema: ok });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    await new Promise((done) => setTimeout(done, 10));
    expect(fetch).toHaveBeenCalledOnce();
    release();
    await Promise.all([first, second]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("scrubs secrets from error text, even when the service echoes them", async () => {
    const { fetch } = fakeFetch(json({ error: `bad key ${FIRECRAWL_KEY}` }, 400));
    const error = await caught(client(fetch, { secrets: [FIRECRAWL_KEY] }).request({ path: "/a", schema: ok }));
    expect(error.message).toContain("[redacted]");
    expect(error.message).not.toContain(FIRECRAWL_KEY);
    expect(error.userMessage).not.toContain(FIRECRAWL_KEY);
  });
});

describe("Firecrawl", () => {
  const page = (data: Record<string, unknown>) => json({ success: true, data });

  it("scrapes one page as markdown with the documented v2 request", async () => {
    const { fetch, calls } = fakeFetch(
      page({ markdown: "# Hi", metadata: { title: ["Hi", "Alt"], sourceURL: "https://example.com/", statusCode: 200 } }),
    );
    const result = await createFirecrawlClient({ apiKey: FIRECRAWL_KEY, fetch, sleep }).scrape("https://example.com");

    expect(result).toMatchObject({ markdown: "# Hi", title: "Hi", url: "https://example.com/", statusCode: 200 });
    expect(calls[0].url).toBe("https://api.firecrawl.dev/v2/scrape");
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${FIRECRAWL_KEY}`);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      url: "https://example.com/",
      formats: [{ type: "markdown" }],
      onlyMainContent: true,
      timeout: 30_000,
    });
  });

  it("extracts validated data with a JSON-format request built from a zod schema", async () => {
    const schema = z.object({ name: z.string(), price: z.number() });
    const { fetch, calls } = fakeFetch(
      page({ json: { name: "Mug", price: 8 }, metadata: { statusCode: 200 } }),
      page({ json: { name: "Mug", price: "eight" }, metadata: { statusCode: 200 } }),
    );
    const firecrawl = createFirecrawlClient({ apiKey: FIRECRAWL_KEY, fetch, sleep });

    const { data } = await firecrawl.extract("https://shop.example/mug", schema, { prompt: "The product" });
    expect(data).toEqual({ name: "Mug", price: 8 });
    const [format] = JSON.parse(String(calls[0].init.body)).formats;
    expect(format).toMatchObject({ type: "json", prompt: "The product", schema: { type: "object" } });
    expect(format.schema.$schema).toBeUndefined();
    expect(format.schema.properties).toHaveProperty("price");

    const mismatch = await caught(firecrawl.extract("https://shop.example/mug", schema));
    expect(mismatch.kind).toBe("invalid_response");
  });

  it("reports a page that loaded with an error status (Firecrawl still charges for it)", async () => {
    const { fetch } = fakeFetch(page({ markdown: "", metadata: { statusCode: 404 } }));
    const error = await caught(createFirecrawlClient({ apiKey: FIRECRAWL_KEY, fetch, sleep }).scrape("https://example.com/gone"));
    expect(error.kind).toBe("not_found");
  });

  it("maps out-of-credits and unsupported sites to clear errors", async () => {
    const { fetch } = fakeFetch(
      json({ success: false, error: "Payment required" }, 402),
      json({ success: false, error: "This website is no longer supported" }, 403),
    );
    const firecrawl = createFirecrawlClient({ apiKey: FIRECRAWL_KEY, fetch, sleep });
    const credits = await caught(firecrawl.scrape("https://example.com"));
    expect(credits.kind).toBe("quota_exceeded");
    expect(credits.userMessage).toBe("Firecrawl has run out of free usage for now.");
    expect((await caught(firecrawl.scrape("https://example.com"))).kind).toBe("bad_request");
  });

  it("searches with a clamped result limit", async () => {
    const { fetch, calls } = fakeFetch(
      json({ success: true, data: { web: [{ url: "https://a.example", title: "A" }] } }),
    );
    const results = await createFirecrawlClient({ apiKey: FIRECRAWL_KEY, fetch, sleep }).search(" hackathons ", { limit: 500 });
    expect(results).toEqual([{ url: "https://a.example", title: "A" }]);
    expect(calls[0].url).toBe("https://api.firecrawl.dev/v2/search");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ query: "hackathons", limit: 20 });
  });

  describe("response compatibility (shapes from Firecrawl's v2 SDK types)", () => {
    it("treats a 200 with success: false as a service failure, as the SDK does", async () => {
      const { fetch } = fakeFetch(json({ success: false, error: "Scrape failed: engine error" }));
      const error = await caught(createFirecrawlClient({ apiKey: FIRECRAWL_KEY, fetch, sleep }).scrape("https://example.com"));
      expect(error.kind).toBe("upstream");
      expect(error.message).toContain("engine error");
    });

    it("ignores fields it doesn't use, and passes Firecrawl's warning through", async () => {
      const { fetch } = fakeFetch(
        json({
          success: true,
          warning: "Served from cache",
          scrape_id: "abc",
          data: {
            markdown: "# Hi",
            rawHtml: "<h1>Hi</h1>",
            images: [],
            metadata: { title: "Hi", statusCode: 200, keywords: ["a", "b"], "og:title": "Hi", error: null },
          },
        }),
      );
      const page = await createFirecrawlClient({ apiKey: FIRECRAWL_KEY, fetch, sleep }).scrape("https://example.com");
      expect(page).toMatchObject({ markdown: "# Hi", title: "Hi", warning: "Served from cache" });
    });

    it("distinguishes 'no structured data' from data in the wrong shape", async () => {
      const { fetch } = fakeFetch(page({ markdown: "x", metadata: { statusCode: 200 } }));
      const error = await caught(
        createFirecrawlClient({ apiKey: FIRECRAWL_KEY, fetch, sleep }).extract("https://example.com", z.object({ a: z.string() })),
      );
      expect(error).toMatchObject({ kind: "invalid_response", message: expect.stringContaining("no structured data") });
    });

    it("reads search results that are full Documents, with the URL in metadata", async () => {
      const { fetch, calls } = fakeFetch(
        json({
          success: true,
          data: {
            web: [
              { url: "https://plain.example", title: "Plain" },
              { markdown: "# Doc", metadata: { sourceURL: "https://doc.example", title: "Doc", statusCode: 200 } },
              { markdown: "no url at all" },
            ],
          },
        }),
      );
      const results = await createFirecrawlClient({ apiKey: FIRECRAWL_KEY, fetch, sleep }).search("q", { withContent: true });
      expect(results).toEqual([
        { url: "https://plain.example", title: "Plain" },
        { url: "https://doc.example", title: "Doc", markdown: "# Doc" },
      ]);
      expect(JSON.parse(String(calls[0].init.body)).scrapeOptions).toEqual({
        formats: [{ type: "markdown" }],
        onlyMainContent: true,
      });
    });

    it("returns no results, rather than failing, when search finds nothing", async () => {
      const { fetch } = fakeFetch(json({ success: true, data: {} }));
      await expect(createFirecrawlClient({ apiKey: FIRECRAWL_KEY, fetch, sleep }).search("nothing")).resolves.toEqual([]);
    });
  });

  it("applies the free plan's 10 requests a minute before calling Firecrawl", async () => {
    const fetch = vi.fn(async () => page({ markdown: "x", metadata: { statusCode: 200 } }));
    const firecrawl = createFirecrawlClient({ apiKey: FIRECRAWL_KEY, fetch: fetch as unknown as typeof globalThis.fetch, sleep });
    for (let i = 0; i < 10; i += 1) await firecrawl.scrape("https://example.com");
    expect((await caught(firecrawl.scrape("https://example.com"))).kind).toBe("rate_limited");
    expect(fetch).toHaveBeenCalledTimes(10);
  });

  it.each([
    "file:///etc/passwd",
    "javascript:alert(1)",
    "http://localhost:3000/admin",
    "https://user:pass@example.com",
    "not a url",
  ])("refuses %s before spending a credit", (url) => {
    expect(() => checkPageUrl(url)).toThrow(IntegrationError);
  });

  it("stays off until a key is set, and never shows the key", () => {
    expect(() => getFirecrawl({})).toThrow(expect.objectContaining({ kind: "not_configured" }));
    expect(firecrawlStatus({})).toMatchObject({ state: "off" });
    expect(firecrawlStatus({ FIRECRAWL_API_KEY: "sk-wrong" })).toMatchObject({ state: "invalid" });
    const ready = firecrawlStatus({ FIRECRAWL_API_KEY: FIRECRAWL_KEY });
    expect(ready.state).toBe("ready");
    expect(JSON.stringify(ready)).not.toContain(FIRECRAWL_KEY);
    expect(getFirecrawl({ FIRECRAWL_API_KEY: FIRECRAWL_KEY })).toBe(getFirecrawl({ FIRECRAWL_API_KEY: FIRECRAWL_KEY }));
  });
});

describe("GitHub", () => {
  const repo = {
    full_name: "octo/demo",
    description: null,
    html_url: "https://github.com/octo/demo",
    stargazers_count: 3,
    forks_count: 1,
    open_issues_count: 2,
    language: "TypeScript",
    topics: ["hackathon"],
    pushed_at: "2026-11-01T10:00:00Z",
    archived: false,
    owner: { login: "octo" },
  };

  it("sends the headers GitHub requires, with no token by default", async () => {
    const { fetch, calls } = fakeFetch(json(repo));
    const result = await createGitHubClient({ fetch, sleep }).getRepository("https://github.com/octo/demo.git");
    expect(result).toMatchObject({ fullName: "octo/demo", stars: 3, topics: ["hackathon"] });
    expect(calls[0].url).toBe("https://api.github.com/repos/octo/demo");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers).toMatchObject({
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "User-Agent": "guh2026-starter",
    });
    expect(headers.Authorization).toBeUndefined();
  });

  it("uses a token when one is configured", async () => {
    const { fetch, calls } = fakeFetch(json(repo));
    await createGitHubClient({ token: GITHUB_KEY, fetch, sleep }).getRepository("octo/demo");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${GITHUB_KEY}`);
  });

  it.each(["octo", "octo/demo/extra", "../etc/passwd", "-bad/name", "octo/de mo"])(
    "rejects %s as a repository name",
    (name) => {
      expect(() => parseRepositoryName(name)).toThrow(IntegrationError);
    },
  );

  it("reports a missing repository as not_found", async () => {
    const { fetch } = fakeFetch(json({ message: "Not Found" }, 404));
    expect((await caught(createGitHubClient({ fetch, sleep }).getRepository("octo/nope"))).kind).toBe("not_found");
  });

  it("verifies webhook signatures with GitHub's published test vector", () => {
    const secret = "It's a Secret to Everybody";
    const signature = "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17";
    expect(verifyWebhookSignature("Hello, World!", signature, secret)).toBe(true);
    expect(verifyWebhookSignature("Hello, World?", signature, secret)).toBe(false);
    expect(verifyWebhookSignature("Hello, World!", signature, "wrong secret")).toBe(false);
    expect(verifyWebhookSignature("Hello, World!", "sha256=abc", secret)).toBe(false);
    expect(verifyWebhookSignature("Hello, World!", null, secret)).toBe(false);
    expect(verifyWebhookSignature("Hello, World!", signature, "")).toBe(false);
  });

  it("ignores the gh CLI's GITHUB_TOKEN and reports its own token state safely", () => {
    expect(githubStatus({ GITHUB_TOKEN: GITHUB_KEY }).detail).toContain("no token");
    expect(githubStatus({ GITHUB_API_TOKEN: "not-a-token" }).state).toBe("invalid");
    const ready = githubStatus({ GITHUB_API_TOKEN: GITHUB_KEY });
    expect(ready).toMatchObject({ state: "ready", detail: expect.stringContaining("5,000") });
    expect(JSON.stringify(ready)).not.toContain(GITHUB_KEY);
  });
});

describe("getIntegrationStatuses", () => {
  it("lists every integration, reading env only and never values", () => {
    const statuses = getIntegrationStatuses({ FIRECRAWL_API_KEY: FIRECRAWL_KEY, GITHUB_API_TOKEN: GITHUB_KEY });
    expect(statuses.map((status) => status.id)).toEqual(["firecrawl", "github"]);
    const text = JSON.stringify(statuses);
    expect(text).not.toContain(FIRECRAWL_KEY);
    expect(text).not.toContain(GITHUB_KEY);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  DEFAULT_VOICE_ID,
  createElevenLabsClient,
  elevenLabsStatus,
  getElevenLabs,
} from "@/lib/integrations/elevenlabs";
import {
  describeRuntime,
  isHostedRuntime,
  isLocalUrl,
  readIntegrationEnv,
} from "@/lib/integrations/env";
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
import {
  N8N_SECRET_HEADER,
  createN8nClient,
  getN8n,
  isAuthorizedN8nCallback,
  n8nStatus,
} from "@/lib/integrations/n8n";
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

  it("never logs a key that an API puts in the path (NASA FIRMS does)", async () => {
    const key = "0123456789abcdef0123456789abcdef";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fetch } = fakeFetch(new Response("upstream down", { status: 503 }));
    const failed = await caught(
      client(fetch, { secrets: [key], retries: 0 }).request({ path: `/api/area/csv/${key}/VIIRS_SNPP_NRT/-3,53,-2,54/1`, schema: ok }),
    );
    expect(failed.message).not.toContain(key);
    expect(warn).toHaveBeenCalled();
    for (const call of warn.mock.calls) expect(String(call[0])).not.toContain(key);
    warn.mockRestore();
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

describe("binary responses and uploads", () => {
  const client = (fetch: typeof globalThis.fetch) =>
    createApiClient({ integration: "Demo", baseUrl: "https://api.example.com", fetch, sleep });

  it("returns bytes and the content type, with the requested Accept header", async () => {
    const { fetch, calls } = fakeFetch(
      new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } }),
    );
    const result = await client(fetch).requestBinary({ method: "POST", path: "/speak", body: { t: 1 }, accept: "audio/mpeg" });
    expect(new Uint8Array(result.data)).toEqual(new Uint8Array([1, 2, 3]));
    expect(result.contentType).toBe("audio/mpeg");
    expect((calls[0].init.headers as Record<string, string>).Accept).toBe("audio/mpeg");
  });

  it("refuses an oversized or empty body", async () => {
    const { fetch } = fakeFetch(
      new Response(new Uint8Array(10), { headers: { "content-length": "999999999" } }),
      new Response(new Uint8Array(0)),
    );
    const api = client(fetch);
    expect((await caught(api.requestBinary({ path: "/a", maxBytes: 100 }))).message).toContain("too large");
    expect((await caught(api.requestBinary({ path: "/a" }))).message).toContain("empty");
  });

  it("sends FormData as multipart, without forcing a JSON content type", async () => {
    const { fetch, calls } = fakeFetch(json({ ok: true }));
    const form = new FormData();
    form.set("file", new Blob(["x"], { type: "audio/webm" }), "a.webm");
    await client(fetch).request({ method: "POST", path: "/upload", body: form, schema: ok });
    expect(calls[0].init.body).toBe(form);
    expect((calls[0].init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });
});

describe("ElevenLabs", () => {
  const KEY = ["sk", "_", "0123456789abcdef".repeat(3)].join("");
  const audio = () => new Response(new Uint8Array([9, 9, 9]), { headers: { "content-type": "audio/mpeg" } });
  const client = (fetch: typeof globalThis.fetch, extra = {}) =>
    createElevenLabsClient({ apiKey: KEY, fetch, sleep, ...extra });

  it("speaks with the documented request: voice in the path, format in the query, xi-api-key header", async () => {
    const { fetch, calls } = fakeFetch(audio());
    const speech = await client(fetch).speak("  Hello there  ");
    expect(speech).toMatchObject({ contentType: "audio/mpeg", characters: 11 });
    expect(speech.audio.byteLength).toBe(3);
    expect(calls[0].url).toBe(
      `https://api.elevenlabs.io/v1/text-to-speech/${DEFAULT_VOICE_ID}?output_format=mp3_44100_128`,
    );
    expect((calls[0].init.headers as Record<string, string>)["xi-api-key"]).toBe(KEY);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ text: "Hello there", model_id: "eleven_flash_v2_5" });
  });

  it("refuses empty or overlong text before spending anything", async () => {
    const { fetch } = fakeFetch();
    expect((await caught(client(fetch).speak("   "))).kind).toBe("bad_request");
    expect((await caught(client(fetch).speak("x".repeat(2501)))).kind).toBe("bad_request");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps to a daily character budget, and refunds characters ElevenLabs refused", async () => {
    const { fetch } = fakeFetch(audio(), json({ detail: [{ msg: "bad voice" }] }, 422), audio());
    const eleven = client(fetch, { maxCharactersPerDay: 10 });
    await eleven.speak("hello"); // 5 of 10 used
    expect((await caught(eleven.speak("world"))).kind).toBe("bad_request"); // refused, refunded
    await eleven.speak("again"); // 10 of 10 used
    const over = await caught(eleven.speak("x"));
    expect(over).toMatchObject({ kind: "rate_limited", userMessage: "Today's speech allowance on this server is used up." });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.each([
    [401, { detail: { code: "detected_unusual_activity", message: "Unusual activity detected. Free Tier usage disabled." } }, "unauthorized", /paused free-tier use/],
    [402, { detail: { type: "payment_required", code: "insufficient_credits" } }, "quota_exceeded", /run out/],
    [401, { detail: { status: "quota_exceeded", message: "This request exceeds your quota" } }, "quota_exceeded", /run out/],
    [429, { detail: { code: "concurrent_limit_exceeded" } }, "rate_limited", /busy/],
  ])("maps HTTP %i with ElevenLabs' error code to a clear message", async (status, body, kind, message) => {
    const { fetch } = fakeFetch(json(body, status));
    const error = await caught(client(fetch).speak("hi"));
    expect(error.kind).toBe(kind);
    expect(error.userMessage).toMatch(message);
    expect(error.message).not.toContain(KEY);
  });

  it("transcribes audio as multipart with Scribe v2, keeping words only", async () => {
    const { fetch, calls } = fakeFetch(
      json({
        text: "Hi there",
        language_code: "eng",
        words: [
          { text: "Hi", type: "word", start: 0, end: 0.3, speaker_id: "speaker_0" },
          { text: " ", type: "spacing", start: 0.3, end: 0.35 },
          { text: "there", type: "word", start: 0.35, end: 0.8, speaker_id: "speaker_0" },
        ],
      }),
    );
    const transcript = await client(fetch).transcribe(new File(["abc"], "note.webm", { type: "audio/webm" }), { diarize: true });
    expect(transcript).toEqual({
      text: "Hi there",
      languageCode: "eng",
      words: [
        { text: "Hi", start: 0, end: 0.3, speaker: "speaker_0" },
        { text: "there", start: 0.35, end: 0.8, speaker: "speaker_0" },
      ],
    });
    expect(calls[0].url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    const form = calls[0].init.body as FormData;
    expect(form.get("model_id")).toBe("scribe_v2");
    expect(form.get("diarize")).toBe("true");
    expect((form.get("file") as File).name).toBe("note.webm");
  });

  it("refuses files that aren't audio, or are empty or too large", async () => {
    const { fetch } = fakeFetch();
    const eleven = client(fetch);
    expect((await caught(eleven.transcribe(new Blob(["<html>"], { type: "text/html" })))).kind).toBe("bad_request");
    expect((await caught(eleven.transcribe(new Blob([], { type: "audio/webm" })))).kind).toBe("bad_request");
    expect((await caught(eleven.transcribe(new Blob([new Uint8Array(11 * 1024 * 1024)], { type: "audio/webm" })))).kind).toBe("bad_request");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("lists premade voices, reads usage and issues single-use browser tokens", async () => {
    const reset = 1_800_000_000;
    const { fetch, calls } = fakeFetch(
      json({ voices: [{ voice_id: "v1", name: "George", category: "premade", preview_url: null }], has_more: false }),
      json({ tier: "free", character_count: 1200, character_limit: 10000, next_character_count_reset_unix: reset }),
      json({ token: "sutkn_abc" }),
    );
    const eleven = client(fetch);
    expect(await eleven.listVoices()).toEqual([{ id: "v1", name: "George", category: "premade" }]);
    expect(calls[0].url).toBe("https://api.elevenlabs.io/v2/voices?category=premade&page_size=50");
    expect(await eleven.getUsage()).toEqual({
      tier: "free",
      used: 1200,
      limit: 10000,
      remaining: 8800,
      resetsAt: new Date(reset * 1000).toISOString(),
    });
    expect(await eleven.createBrowserToken("realtime_scribe")).toBe("sutkn_abc");
    expect(calls[2].url).toBe("https://api.elevenlabs.io/v1/single-use-token/realtime_scribe");
  });

  it("stays off until a key is set, and never shows the key", () => {
    expect(() => getElevenLabs({})).toThrow(expect.objectContaining({ kind: "not_configured" }));
    expect(elevenLabsStatus({}).state).toBe("off");
    expect(elevenLabsStatus({ ELEVENLABS_API_KEY: "short" }).state).toBe("invalid");
    const ready = elevenLabsStatus({ ELEVENLABS_API_KEY: KEY });
    expect(ready).toMatchObject({ state: "ready", detail: expect.stringContaining("eleven_flash_v2_5") });
    expect(JSON.stringify(ready)).not.toContain(KEY);
  });
});

describe("n8n", () => {
  const SECRET = "n8n-secret-0123456789";
  const URL_ = "https://team.app.n8n.cloud/webhook/abc-123?source=app";

  it("posts { event, sentAt, payload } to the exact webhook URL with the secret header", async () => {
    const { fetch, calls } = fakeFetch(json({ summary: "done" }));
    const reply = await createN8nClient({ webhookUrl: URL_, secret: SECRET, fetch, sleep }).trigger(
      "note.created",
      { id: 1 },
      { schema: z.object({ summary: z.string() }) },
    );
    expect(reply).toEqual({ summary: "done" });
    expect(calls[0].url).toBe(URL_);
    expect((calls[0].init.headers as Record<string, string>)[N8N_SECRET_HEADER]).toBe(SECRET);
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ event: "note.created", payload: { id: 1 }, sentAt: expect.any(String) });
  });

  it("does not retry, so a workflow never runs twice by accident", async () => {
    const { fetch } = fakeFetch(json({}, 503));
    expect((await caught(createN8nClient({ webhookUrl: URL_, secret: SECRET, fetch, sleep }).trigger("x", {}))).kind).toBe("upstream");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("accepts n8n's plain-text 'Respond Immediately' reply instead of failing", async () => {
    const { fetch } = fakeFetch(new Response("Workflow got started", { headers: { "content-type": "text/html" } }));
    await expect(
      createN8nClient({ webhookUrl: URL_, secret: SECRET, fetch, sleep }).trigger("x", {}),
    ).resolves.toBe("Workflow got started");
  });

  it("refuses a localhost webhook on a hosted deployment, which could never reach it", () => {
    const local = { N8N_WEBHOOK_URL: "http://localhost:5678/webhook/x", N8N_WEBHOOK_SECRET: SECRET };
    expect(n8nStatus(local)).toMatchObject({ state: "ready", detail: expect.stringContaining("this machine only") });
    const hosted = n8nStatus({ ...local, VERCEL: "1" });
    expect(hosted.state).toBe("invalid");
    expect(hosted.detail).toContain("hosted deployment can't reach");
    expect(() => getN8n({ ...local, VERCEL: "1" })).toThrow(expect.objectContaining({ kind: "not_configured" }));
    // A public n8n URL is fine anywhere.
    expect(n8nStatus({ N8N_WEBHOOK_URL: URL_, N8N_WEBHOOK_SECRET: SECRET, VERCEL: "1" }).state).toBe("ready");
  });

  it("warns when the test URL is configured instead of the production URL", () => {
    const status = n8nStatus({ N8N_WEBHOOK_URL: "https://team.app.n8n.cloud/webhook-test/abc", N8N_WEBHOOK_SECRET: SECRET });
    expect(status.detail).toContain("test URL");
  });

  it("refuses odd event names", async () => {
    const { fetch } = fakeFetch();
    expect((await caught(createN8nClient({ webhookUrl: URL_, secret: SECRET, fetch, sleep }).trigger("../x", {}))).kind).toBe("bad_request");
  });

  it("needs both the URL and a strong secret, and allows a local npx n8n", () => {
    expect(n8nStatus({ N8N_WEBHOOK_URL: URL_ }).state).toBe("off");
    expect(n8nStatus({ N8N_WEBHOOK_URL: URL_, N8N_WEBHOOK_SECRET: "short" }).state).toBe("invalid");
    expect(n8nStatus({ N8N_WEBHOOK_URL: "http://example.com/webhook/x", N8N_WEBHOOK_SECRET: SECRET }).state).toBe("invalid");
    const local = n8nStatus({ N8N_WEBHOOK_URL: "http://localhost:5678/webhook/x", N8N_WEBHOOK_SECRET: SECRET });
    expect(local).toMatchObject({ state: "ready", detail: expect.stringContaining("localhost:5678") });
    expect(JSON.stringify(local)).not.toContain(SECRET);
    expect(() => getN8n({})).toThrow(expect.objectContaining({ kind: "not_configured" }));
  });

  it("authorises callbacks only with the configured Bearer secret", () => {
    const env = { N8N_WEBHOOK_URL: URL_, N8N_WEBHOOK_SECRET: SECRET, N8N_CALLBACK_SECRET: "callback-secret-0123456789" };
    const call = (authorization?: string) =>
      new Request("https://app.example/api/n8n", { method: "POST", headers: authorization ? { authorization } : {} });
    expect(isAuthorizedN8nCallback(call("Bearer callback-secret-0123456789"), env)).toBe(true);
    expect(isAuthorizedN8nCallback(call("Bearer wrong"), env)).toBe(false);
    expect(isAuthorizedN8nCallback(call(), env)).toBe(false);
    expect(isAuthorizedN8nCallback(call("Bearer callback-secret-0123456789"), { ...env, N8N_CALLBACK_SECRET: "" })).toBe(false);
  });
});

describe("runtime environment", () => {
  it("tells this machine apart from a hosted deployment", () => {
    expect(isHostedRuntime({})).toBe(false);
    expect(isHostedRuntime({ GITHUB_ACTIONS: "true" })).toBe(false);
    expect(isHostedRuntime({ VERCEL: "1" })).toBe(true);
    expect(describeRuntime({ NODE_ENV: "development" })).toContain("development server");
    expect(describeRuntime({ NODE_ENV: "production" })).toContain("production build");
    expect(describeRuntime({ VERCEL: "1", VERCEL_ENV: "production", VERCEL_REGION: "lhr1" })).toBe(
      "Hosted on Vercel (production, region lhr1)",
    );
  });

  it("recognises local URLs", () => {
    for (const url of ["http://localhost:5678/x", "http://127.0.0.1/x", "http://[::1]:5678/x", "http://n8n.localhost/x"]) {
      expect(isLocalUrl(url)).toBe(true);
    }
    expect(isLocalUrl("https://team.app.n8n.cloud/webhook/x")).toBe(false);
  });
});

describe("getIntegrationStatuses", () => {
  it("lists every integration, reading env only and never values", () => {
    const statuses = getIntegrationStatuses({ FIRECRAWL_API_KEY: FIRECRAWL_KEY, GITHUB_API_TOKEN: GITHUB_KEY });
    expect(statuses.map((status) => status.id)).toEqual(["elevenlabs", "n8n", "firecrawl", "github"]);
    const text = JSON.stringify(statuses);
    expect(text).not.toContain(FIRECRAWL_KEY);
    expect(text).not.toContain(GITHUB_KEY);
  });
});

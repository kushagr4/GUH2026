import "server-only";
import type { z } from "zod";
import { createRateLimiter } from "@/lib/rate-limit";
import { IntegrationError, type IntegrationErrorKind } from "./errors";

/** At most `limit` outbound requests per `windowMs`, per server instance. */
export type RateLimitRule = { limit: number; windowMs: number };

export type ApiClientOptions = {
  /** Display name, used in errors and logs, for example "Firecrawl". */
  integration: string;
  baseUrl: string;
  /** Sent on every request, for example Authorization. */
  headers?: Record<string, string>;
  /** Values to scrub from any error text, such as the API key. */
  secrets?: Array<string | undefined>;
  /** Per attempt. Defaults to 15 seconds. */
  timeoutMs?: number;
  /** Extra attempts for retry-safe requests. Defaults to 2. */
  retries?: number;
  /** Protects a free tier from a loop or an eager demo audience. */
  rateLimits?: RateLimitRule[];
  /** Requests in flight at once. Extra requests wait their turn. */
  maxConcurrent?: number;
  /** Retries never wait longer than this. A longer Retry-After fails fast instead. */
  maxRetryDelayMs?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

export type ApiRequest<Schema extends z.ZodType> = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Relative to baseUrl and starting with "/". Absolute URLs are refused. */
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  /** Sent as JSON, or as-is for FormData (multipart uploads), Blob or bytes. */
  body?: unknown;
  /** Validates the response. Select only the fields you use. */
  schema: Schema;
  /** If the body isn't JSON, validate the raw text instead of failing. */
  acceptText?: boolean;
  timeoutMs?: number;
  /**
   * Retry on 429, 5xx, timeouts and network errors. Defaults to true for GET
   * only, because retrying a POST can do the work, and spend the credit, twice.
   */
  retry?: boolean;
  signal?: AbortSignal;
};

/** For audio, images and other files. The whole body is read, up to `maxBytes`. */
export type BinaryRequest = Omit<ApiRequest<z.ZodType>, "schema"> & {
  /** The Accept header, for example "audio/mpeg". */
  accept?: string;
  /** Larger responses are refused. Defaults to 10 MB. */
  maxBytes?: number;
};

export type BinaryResponse = { data: ArrayBuffer; contentType: string };

export type ApiClient = {
  request<Schema extends z.ZodType>(request: ApiRequest<Schema>): Promise<z.infer<Schema>>;
  requestBinary(request: BinaryRequest): Promise<BinaryResponse>;
};

function encodeBody(body: unknown): { body?: BodyInit; contentType?: string } {
  if (body === undefined) return {};
  if (
    body instanceof FormData ||
    body instanceof Blob ||
    body instanceof URLSearchParams ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body)
  ) {
    // fetch sets the right Content-Type, including the multipart boundary.
    return { body: body as BodyInit };
  }
  return { body: JSON.stringify(body), contentType: "application/json" };
}

/**
 * Worth another attempt: timeouts, network failures, and 429 or 5xx from the
 * service. Not our own local rate limit, which won't clear by retrying at once.
 */
function isTransient(error: IntegrationError): boolean {
  if (error.kind === "timeout" || error.kind === "network") return true;
  const fromService = error.upstreamStatus !== undefined;
  return fromService && (error.kind === "rate_limited" || error.kind === "upstream");
}

function createSemaphore(max: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}

function classify(status: number, headers: Headers): IntegrationErrorKind {
  if (status === 404) return "not_found";
  if (status === 401) return "unauthorized";
  if (status === 402) return "quota_exceeded";
  if (status === 408) return "timeout";
  if (status === 429) return "rate_limited";
  // GitHub signals rate limits with 403 as well as 429.
  if (status === 403) {
    return headers.get("x-ratelimit-remaining") === "0" || headers.has("retry-after")
      ? "rate_limited"
      : "unauthorized";
  }
  if (status >= 400 && status < 500) return "bad_request";
  return "upstream";
}

function retryAfterSeconds(headers: Headers, now = Date.now()): number | undefined {
  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(1, Math.ceil(seconds));
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(1, Math.ceil((date - now) / 1000));
  }
  const reset = Number(headers.get("x-ratelimit-reset"));
  if (headers.get("x-ratelimit-remaining") === "0" && Number.isFinite(reset) && reset > 0) {
    return Math.max(1, Math.ceil(reset - now / 1000));
  }
  return undefined;
}

/**
 * A small, dependency-free JSON client for one external API. Create it once per
 * process (module scope), so its rate limits and concurrency cap are shared by
 * every request. Every failure becomes an IntegrationError.
 */
export function createApiClient(options: ApiClientOptions): ApiClient {
  const {
    integration,
    timeoutMs: defaultTimeout = 15_000,
    retries = 2,
    maxRetryDelayMs = 5_000,
    fetch: fetchImpl = globalThis.fetch,
    sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = options;
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const secrets = (options.secrets ?? []).filter((value): value is string => !!value);
  const limiters = (options.rateLimits ?? []).map((rule) => createRateLimiter(rule));
  const run = createSemaphore(options.maxConcurrent ?? 10);

  function scrub(text: string): string {
    return secrets.reduce((result, secret) => result.split(secret).join("[redacted]"), text);
  }

  function fail(
    kind: IntegrationErrorKind,
    detail: string,
    extra: { upstreamStatus?: number; retryAfterSeconds?: number; cause?: unknown } = {},
  ): IntegrationError {
    return new IntegrationError(integration, kind, scrub(`${integration}: ${detail}`), extra);
  }

  function buildUrl(path: string, query: ApiRequest<z.ZodType>["query"]): URL {
    // Refusing absolute URLs keeps the Authorization header on the intended host.
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("://")) {
      throw fail("bad_request", `refused a path that is not relative: ${path.slice(0, 80)}`);
    }
    const url = new URL(`${baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url;
  }

  type Reader<T> = (response: Response, label: string) => Promise<T>;

  const readJson =
    <Schema extends z.ZodType>(schema: Schema, acceptText = false): Reader<z.infer<Schema>> =>
    async (response, label) => {
      const text = await response.text();
      let json: unknown;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        if (!acceptText) throw fail("invalid_response", `${label} did not return JSON`);
        json = text;
      }
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        const fields = parsed.error.issues.map((issue) => issue.path.join(".") || "(root)");
        throw fail("invalid_response", `${label} response did not match the schema at ${fields.join(", ")}`);
      }
      return parsed.data;
    };

  const readBinary =
    (maxBytes: number): Reader<BinaryResponse> =>
    async (response, label) => {
      const declared = Number(response.headers.get("content-length"));
      if (declared > maxBytes) throw fail("invalid_response", `${label} response is too large`);
      const data = await response.arrayBuffer();
      if (data.byteLength > maxBytes) throw fail("invalid_response", `${label} response is too large`);
      if (data.byteLength === 0) throw fail("invalid_response", `${label} returned an empty body`);
      return {
        data,
        contentType: response.headers.get("content-type") ?? "application/octet-stream",
      };
    };

  async function attempt<T>(
    request: Omit<ApiRequest<z.ZodType>, "schema"> & { accept?: string },
    url: URL,
    label: string,
    read: Reader<T>,
  ): Promise<T> {
    for (const limiter of limiters) {
      const { allowed, retryAfterSeconds: wait } = limiter.check("outbound");
      if (!allowed) {
        throw fail("rate_limited", `${label} held back by the local rate limit`, {
          retryAfterSeconds: wait,
        });
      }
    }

    const timeout = AbortSignal.timeout(request.timeoutMs ?? defaultTimeout);
    const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
    const { body, contentType } = encodeBody(request.body);

    // Both the request and reading the body count toward the timeout.
    try {
      const response = await fetchImpl(url, {
        method: request.method ?? "GET",
        headers: {
          Accept: "application/json",
          ...(contentType ? { "Content-Type": contentType } : {}),
          ...options.headers,
          ...(request.accept ? { Accept: request.accept } : {}),
        },
        body,
        signal,
        cache: "no-store",
      });

      if (!response.ok) {
        const text = await response.text();
        const kind = classify(response.status, response.headers);
        throw fail(kind, `${label} returned HTTP ${response.status}: ${text.slice(0, 300)}`, {
          upstreamStatus: response.status,
          retryAfterSeconds: retryAfterSeconds(response.headers),
        });
      }
      return await read(response, label);
    } catch (error) {
      if (error instanceof IntegrationError) throw error;
      if (request.signal?.aborted) throw fail("cancelled", `${label} was cancelled`);
      if (timeout.aborted) throw fail("timeout", `${label} timed out`, { cause: error });
      throw fail("network", `${label} could not connect`, { cause: error });
    }
  }

  async function execute<T>(
    request: Omit<ApiRequest<z.ZodType>, "schema"> & { accept?: string },
    read: Reader<T>,
  ): Promise<T> {
    const method = request.method ?? "GET";
    // Scrubbed, because some APIs (NASA FIRMS) put the key in the path itself.
    const label = scrub(`${method} ${request.path.split("?")[0]}`);
    const url = buildUrl(request.path, request.query);
    const retry = request.retry ?? method === "GET";

    return run(async () => {
      for (let attemptNumber = 0; ; attemptNumber += 1) {
        try {
          return await attempt(request, url, label, read);
        } catch (error) {
          if (!(error instanceof IntegrationError)) throw error;
          const delay = error.retryAfterSeconds
            ? error.retryAfterSeconds * 1000
            : 250 * 2 ** attemptNumber + Math.floor(Math.random() * 100);
          const canRetry =
            retry && attemptNumber < retries && delay <= maxRetryDelayMs && isTransient(error);
          if (!canRetry) {
            const status = error.upstreamStatus ? ` (HTTP ${error.upstreamStatus})` : "";
            console.warn(`[integrations] ${integration} ${label} failed: ${error.kind}${status}`);
            throw error;
          }
          await sleep(delay);
        }
      }
    });
  }

  return {
    // async, so even an invalid path is a rejected promise rather than a throw.
    async request(request) {
      return execute(request, readJson(request.schema, request.acceptText));
    },
    async requestBinary(request) {
      return execute(request, readBinary(request.maxBytes ?? 10 * 1024 * 1024));
    },
  };
}

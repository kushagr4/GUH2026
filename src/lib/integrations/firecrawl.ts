import "server-only";
import { z } from "zod";
import { readIntegrationEnv, type EnvSource, type IntegrationStatus } from "./env";
import { IntegrationError } from "./errors";
import { createApiClient, type ApiClientOptions } from "./http";

/**
 * Firecrawl turns public web pages into markdown or structured JSON.
 * OPTIONAL: it stays off until FIRECRAWL_API_KEY is set, so nothing here runs
 * or costs anything until the team decides to use it. See docs/sponsor-comparison.md.
 *
 * API v2 (https://docs.firecrawl.dev/api-reference/endpoint/scrape), checked 7 Nov 2026.
 */
const NAME = "Firecrawl";

/** Free plan, as documented on 7 Nov 2026. */
export const FIRECRAWL_FREE_TIER = {
  credits: 1000,
  scrapesPerMinute: 10,
  concurrentBrowsers: 2,
  creditsPerScrape: 1,
  creditsPerJsonScrape: 5,
} as const;

export const FIRECRAWL_ENV = {
  apiKey: { name: "FIRECRAWL_API_KEY", pattern: /^fc-[A-Za-z0-9]+$/, hint: "start with fc-" },
  baseUrl: {
    name: "FIRECRAWL_API_URL",
    required: false,
    default: "https://api.firecrawl.dev",
    url: true,
  },
  maxRequestsPerDay: {
    name: "FIRECRAWL_MAX_REQUESTS_PER_DAY",
    required: false,
    default: "100",
    pattern: /^\d{1,5}$/,
    hint: "be a whole number",
  },
} as const;

const firstString = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value) => (Array.isArray(value) ? value[0] : value));

// Shapes follow Firecrawl's own v2 SDK types (apps/js-sdk/firecrawl/src/v2/types.ts,
// checked 7 Nov 2026): scrape returns { success, data: Document }, search returns
// { success, data: { web: Array<SearchResultWeb | Document> } }. Unknown fields are
// ignored, and older array-valued metadata is tolerated.
const metadataSchema = z.object({
  title: firstString,
  description: firstString,
  sourceURL: z.string().optional(),
  url: z.string().optional(),
  statusCode: z.number().optional(),
  error: z.string().nullish(),
});

const documentSchema = z.object({
  markdown: z.string().optional(),
  summary: z.string().optional(),
  links: z.array(z.string()).optional(),
  json: z.unknown().optional(),
  warning: z.string().nullish(),
  metadata: metadataSchema.optional(),
});

/** Firecrawl can answer 200 with success: false, which its SDK also treats as a failure. */
const envelope = <Data extends z.ZodType>(data: Data) =>
  z.object({
    success: z.boolean(),
    error: z.string().optional(),
    warning: z.string().nullish(),
    data: data.optional(),
  });

const scrapeResponse = envelope(documentSchema);

// A plain result has a top-level url; with page content it is a full Document.
const searchResultSchema = documentSchema.extend({
  url: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
});

const searchResponse = envelope(
  z.object({ web: z.array(searchResultSchema).optional() }),
);

export type FirecrawlPage = {
  markdown?: string;
  summary?: string;
  links?: string[];
  title?: string;
  description?: string;
  url?: string;
  /** The status the page itself returned to Firecrawl. */
  statusCode?: number;
  /** Firecrawl's own note about the result, when it gives one. */
  warning?: string;
};

export type ScrapeOptions = {
  /** Defaults to markdown only, which costs 1 credit. */
  formats?: Array<"markdown" | "summary" | "links" | "html">;
  /** Strips navigation, footers and the like. Defaults to true. */
  onlyMainContent?: boolean;
  /** Accept a cached copy up to this old. Firecrawl's default is 2 days; 0 forces a fresh fetch. */
  maxAgeMs?: number;
  /** Extra wait for JavaScript-heavy pages. */
  waitForMs?: number;
  signal?: AbortSignal;
};

export type ExtractOptions = Omit<ScrapeOptions, "formats"> & {
  /** Plain-language guidance for the extraction, alongside the schema. */
  prompt?: string;
};

export type SearchResult = {
  url: string;
  title?: string;
  description?: string;
  /** Only with `withContent: true`. */
  markdown?: string;
};

export type SearchOptions = {
  /** 1 to 20. Defaults to 5. */
  limit?: number;
  /**
   * Also scrape each result as markdown, in the same call. Costs 1 extra credit
   * per result, but saves a round trip each.
   */
  withContent?: boolean;
  signal?: AbortSignal;
};

export type FirecrawlClient = {
  /** One page as markdown (1 credit). */
  scrape(url: string, options?: ScrapeOptions): Promise<FirecrawlPage>;
  /** One page as data matching `schema` (5 credits). The result is validated. */
  extract<Schema extends z.ZodType>(
    url: string,
    schema: Schema,
    options?: ExtractOptions,
  ): Promise<{ data: z.infer<Schema>; page: FirecrawlPage }>;
  /** Web search (2 credits per 10 results, plus 1 per result with `withContent`). */
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
};

/** Only public http(s) pages. Firecrawl fetches from its own servers. */
export function checkPageUrl(value: string): string {
  let url: URL | undefined;
  try {
    url = new URL(value.trim());
  } catch {
    // Reported below.
  }
  const local = ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"];
  if (
    !url ||
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    local.includes(url.hostname) ||
    value.length > 2048
  ) {
    throw new IntegrationError(NAME, "bad_request", "Firecrawl: refused a URL that is not a public http(s) page");
  }
  return url.toString();
}

/** Unwraps { success, data }, treating success: false as a failure, as the SDK does. */
function unwrap<Data>(response: { success: boolean; error?: string; data?: Data }): Data {
  if (!response.success || response.data === undefined) {
    throw new IntegrationError(
      NAME,
      "upstream",
      `Firecrawl reported a failure: ${(response.error ?? "no data returned").slice(0, 200)}`,
    );
  }
  return response.data;
}

function toPage(data: z.infer<typeof documentSchema>, warning?: string | null): FirecrawlPage {
  const { metadata } = data;
  return {
    markdown: data.markdown,
    summary: data.summary,
    links: data.links,
    title: metadata?.title,
    description: metadata?.description,
    url: metadata?.sourceURL ?? metadata?.url,
    statusCode: metadata?.statusCode,
    warning: data.warning ?? warning ?? undefined,
  };
}

/** Firecrawl still charges for a page that loaded with an error status. */
function assertPageLoaded(page: FirecrawlPage) {
  const status = page.statusCode;
  if (status && status >= 400) {
    throw new IntegrationError(
      NAME,
      status === 404 ? "not_found" : "upstream",
      `Firecrawl: the page itself returned HTTP ${status}`,
    );
  }
}

export function createFirecrawlClient(
  config: { apiKey: string; baseUrl?: string; maxRequestsPerDay?: number } & Pick<
    ApiClientOptions,
    "fetch" | "sleep"
  >,
): FirecrawlClient {
  const api = createApiClient({
    integration: NAME,
    baseUrl: `${(config.baseUrl ?? FIRECRAWL_ENV.baseUrl.default).replace(/\/+$/, "")}/v2`,
    headers: { Authorization: `Bearer ${config.apiKey}` },
    secrets: [config.apiKey],
    // Firecrawl is told to give up at 30 s (queue time included), so it can
    // answer with a proper error before our own timeout fires.
    timeoutMs: 45_000,
    rateLimits: [
      { limit: FIRECRAWL_FREE_TIER.scrapesPerMinute, windowMs: 60_000 },
      { limit: config.maxRequestsPerDay ?? 100, windowMs: 24 * 60 * 60_000 },
    ],
    maxConcurrent: FIRECRAWL_FREE_TIER.concurrentBrowsers,
    fetch: config.fetch,
    sleep: config.sleep,
  });

  async function scrapeRequest(url: string, formats: unknown[], options: ScrapeOptions = {}) {
    try {
      const response = await api.request({
        method: "POST",
        path: "/scrape",
        body: {
          url: checkPageUrl(url),
          formats,
          onlyMainContent: options.onlyMainContent ?? true,
          timeout: 30_000,
          ...(options.maxAgeMs !== undefined ? { maxAge: options.maxAgeMs } : {}),
          ...(options.waitForMs !== undefined ? { waitFor: options.waitForMs } : {}),
        },
        schema: scrapeResponse,
        signal: options.signal,
      });
      return { document: unwrap(response), warning: response.warning };
    } catch (error) {
      // Firecrawl uses 403 for sites it won't scrape, not only for bad keys.
      if (error instanceof IntegrationError && error.upstreamStatus === 403) {
        throw new IntegrationError(NAME, "bad_request", "Firecrawl refused the page (HTTP 403)", {
          upstreamStatus: 403,
        });
      }
      throw error;
    }
  }

  return {
    async scrape(url, options = {}) {
      const formats = (options.formats ?? ["markdown"]).map((type) => ({ type }));
      const { document, warning } = await scrapeRequest(url, formats, options);
      const page = toPage(document, warning);
      assertPageLoaded(page);
      return page;
    },

    async extract(url, schema, options = {}) {
      const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
      delete jsonSchema.$schema;
      const { document, warning } = await scrapeRequest(
        url,
        [{ type: "json", schema: jsonSchema, ...(options.prompt ? { prompt: options.prompt } : {}) }],
        options,
      );
      const page = toPage(document, warning);
      assertPageLoaded(page);
      if (document.json === undefined || document.json === null) {
        throw new IntegrationError(NAME, "invalid_response", "Firecrawl: no structured data was returned");
      }
      const parsed = schema.safeParse(document.json);
      if (!parsed.success) {
        const fields = parsed.error.issues.map((issue) => issue.path.join(".") || "(root)");
        throw new IntegrationError(
          NAME,
          "invalid_response",
          `Firecrawl: extracted data did not match the schema at ${fields.join(", ")}`,
        );
      }
      return { data: parsed.data, page };
    },

    async search(query, options = {}) {
      const trimmed = query.trim();
      if (!trimmed || trimmed.length > 500) {
        throw new IntegrationError(NAME, "bad_request", "Firecrawl: search query must be 1 to 500 characters");
      }
      const response = await api.request({
        method: "POST",
        path: "/search",
        body: {
          query: trimmed,
          limit: Math.min(Math.max(options.limit ?? 5, 1), 20),
          ...(options.withContent
            ? { scrapeOptions: { formats: [{ type: "markdown" }], onlyMainContent: true } }
            : {}),
        },
        schema: searchResponse,
        signal: options.signal,
      });
      // A result is either a plain hit (url at the top) or a scraped Document
      // (url in metadata). Results with no URL at all are dropped.
      return (unwrap(response).web ?? []).flatMap((result) => {
        const url = result.url ?? result.metadata?.sourceURL ?? result.metadata?.url;
        if (!url) return [];
        return [
          {
            url,
            title: result.title ?? result.metadata?.title,
            description: result.description ?? result.metadata?.description,
            ...(result.markdown !== undefined ? { markdown: result.markdown } : {}),
          },
        ];
      });
    },
  };
}

let cached: { key: string; client: FirecrawlClient } | undefined;

/**
 * The shared client, so its rate limits apply across requests. Throws a
 * not_configured IntegrationError while FIRECRAWL_API_KEY is unset.
 */
export function getFirecrawl(env: EnvSource = process.env): FirecrawlClient {
  const config = readIntegrationEnv(FIRECRAWL_ENV, env);
  if (config.state !== "ready") {
    throw new IntegrationError(NAME, "not_configured", `Firecrawl is ${config.state}: ${config.reason}`);
  }
  const { apiKey, baseUrl, maxRequestsPerDay } = config.values;
  const key = [apiKey, baseUrl, maxRequestsPerDay].join("|");
  if (cached?.key !== key) {
    cached = {
      key,
      client: createFirecrawlClient({
        apiKey,
        baseUrl,
        maxRequestsPerDay: Number(maxRequestsPerDay),
      }),
    };
  }
  return cached.client;
}

export function firecrawlStatus(env: EnvSource = process.env): IntegrationStatus {
  const config = readIntegrationEnv(FIRECRAWL_ENV, env);
  return {
    id: "firecrawl",
    name: NAME,
    state: config.state,
    detail:
      config.state === "ready"
        ? `Key is set. Limited to ${FIRECRAWL_FREE_TIER.scrapesPerMinute} requests a minute and ${config.values.maxRequestsPerDay} a day on this server.`
        : config.state === "off"
          ? "Off (optional). Set FIRECRAWL_API_KEY to turn it on."
          : config.reason,
    variables: Object.values(FIRECRAWL_ENV).map((spec) => spec.name),
    docs: "https://docs.firecrawl.dev",
  };
}

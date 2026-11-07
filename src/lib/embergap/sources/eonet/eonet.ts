import "server-only";
import { IntegrationError, isIntegrationError } from "@/lib/integrations/errors";
import { createApiClient, type ApiClientOptions } from "@/lib/integrations/http";
import { roundCoordinate } from "../../agents/runtime/geo";
import { eonetBbox, eonetResponseSchema, isValidDay, matchEvents, toEventRecords } from "./normalize";
import { EONET_LIMITATIONS, eonetProvenance, eonetQuerySchema, type EonetContext, type EonetQuery } from "./types";

/**
 * NASA EONET v3 wildfire records near a point, as context for an investigation.
 * Keyless. EONET sends X-RateLimit-Limit: 60 (about a minute's window, not
 * documented) and Cache-Control: no-cache, so we budget below it and cache
 * results ourselves. Responses took 1 to 4 s when checked.
 * Checked 7 Nov 2026: https://eonet.gsfc.nasa.gov/docs/v3
 *
 * `getWildfireContext` never throws for an upstream problem: it returns
 * `sourceState: "unavailable"` with a safe message, so one failing source can't
 * stop an investigation. Invalid input is a caller bug and does throw.
 */
const NAME = "NASA EONET";
const BASE_URL = "https://eonet.gsfc.nasa.gov/api/v3";
const MAX_SPAN_DAYS = 366;

export type EonetClientOptions = Pick<ApiClientOptions, "fetch" | "sleep" | "timeoutMs"> & {
  /** For tests. Defaults to the system clock. */
  now?: () => Date;
  /** How long a result is reused. Defaults to 10 minutes. */
  cacheTtlMs?: number;
  /** Results kept, least recently used dropped first. Defaults to 100. */
  maxCacheEntries?: number;
};

export type EonetClient = {
  getWildfireContext(
    query: Omit<EonetQuery, "limit"> & { limit?: number },
    options?: { signal?: AbortSignal },
  ): Promise<EonetContext>;
};

export function normalizeEonetQuery(input: Omit<EonetQuery, "limit"> & { limit?: number }): EonetQuery {
  const parsed = eonetQuerySchema.safeParse({ ...input, limit: input.limit ?? 50 });
  if (!parsed.success) {
    throw new IntegrationError(NAME, "bad_request", `${NAME}: invalid query at ${parsed.error.issues[0]?.path.join(".")}`);
  }
  const query = parsed.data;
  if (!isValidDay(query.start) || !isValidDay(query.end)) {
    throw new IntegrationError(NAME, "bad_request", `${NAME}: start and end must be real dates`);
  }
  const span = (Date.parse(query.end) - Date.parse(query.start)) / 86_400_000;
  if (span < 0 || span > MAX_SPAN_DAYS) {
    throw new IntegrationError(NAME, "bad_request", `${NAME}: the date window must be 0 to ${MAX_SPAN_DAYS} days`);
  }
  // Round to about 1 km: nearby reports share a cache entry, and EONET never
  // sees a reporter's exact location (upstream services log query coordinates).
  return { ...query, latitude: roundCoordinate(query.latitude), longitude: roundCoordinate(query.longitude) };
}

export function createEonetClient(config: EonetClientOptions = {}): EonetClient {
  const now = config.now ?? (() => new Date());
  const ttl = config.cacheTtlMs ?? 10 * 60_000;
  const maxEntries = config.maxCacheEntries ?? 100;
  const cache = new Map<string, { at: number; context: EonetContext }>();
  const api = createApiClient({
    integration: NAME,
    baseUrl: BASE_URL,
    headers: { "User-Agent": "embergap-hackathon-prototype" },
    timeoutMs: config.timeoutMs ?? 15_000,
    retries: 1,
    rateLimits: [
      { limit: 30, windowMs: 60_000 },
      { limit: 1_000, windowMs: 24 * 60 * 60_000 },
    ],
    maxConcurrent: 2,
    fetch: config.fetch,
    sleep: config.sleep,
  });

  async function fetchContext(query: EonetQuery, signal?: AbortSignal): Promise<EonetContext> {
    const retrievedAt = now().toISOString();
    const base = {
      source: "eonet" as const,
      query,
      retrievedAt,
      fromCache: false,
      limitations: [...EONET_LIMITATIONS],
      provenance: eonetProvenance(false),
    };
    try {
      const response = await api.request({
        path: "/events",
        query: {
          // Hard-coded: EONET returns 200 even for a misspelt category.
          category: "wildfires",
          // The default is open only, which would hide closed records.
          status: "all",
          start: query.start,
          end: query.end,
          bbox: eonetBbox(query),
          limit: query.limit,
        },
        schema: eonetResponseSchema,
        signal,
      });
      const records = toEventRecords(response);
      const matches = matchEvents(records, query);
      return {
        ...base,
        sourceState: matches.length ? "available" : "not_observed",
        recordsInBox: records.length,
        matches,
        possiblyTruncated: response.events.length >= query.limit,
      };
    } catch (error) {
      if (!isIntegrationError(error)) throw error;
      return {
        ...base,
        sourceState: "unavailable",
        recordsInBox: 0,
        matches: [],
        possiblyTruncated: false,
        error: { kind: error.kind, message: error.userMessage },
      };
    }
  }

  return {
    async getWildfireContext(input, options = {}) {
      const query = normalizeEonetQuery(input);
      const key = JSON.stringify(query);
      const hit = cache.get(key);
      if (hit && now().getTime() - hit.at < ttl) {
        cache.delete(key);
        cache.set(key, hit);
        // A copy, so a caller changing it can't change what the next caller gets.
        return { ...structuredClone(hit.context), fromCache: true };
      }
      const context = await fetchContext(query, options.signal);
      // Only cache answers. A failure is retried on the next call.
      if (context.sourceState !== "unavailable") {
        cache.set(key, { at: now().getTime(), context: structuredClone(context) });
        while (cache.size > maxEntries) cache.delete(cache.keys().next().value as string);
      }
      return context;
    },
  };
}

let shared: EonetClient | undefined;

/** One client per server instance, so the rate limit and cache are shared. */
export function getEonet(): EonetClient {
  shared ??= createEonetClient();
  return shared;
}

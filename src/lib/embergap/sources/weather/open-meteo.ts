import "server-only";
import type { SourceAdapter } from "@/lib/embergap/contracts";
import { IntegrationError, isIntegrationError } from "@/lib/integrations/errors";
import { createApiClient, type ApiClientOptions } from "@/lib/integrations/http";
import { roundCoordinate } from "../../agents/runtime/geo";
import { OPEN_METEO_VARIABLES, normalizeOpenMeteo, openMeteoResponseSchema } from "./normalize";
import { weatherObservations } from "./observations";
import {
  WEATHER_LIMITATIONS,
  openMeteoProvenance,
  weatherQuerySchema,
  type WeatherContext,
  type WeatherQuery,
} from "./types";

/**
 * Open-Meteo Forecast API: model weather around a point and time, as context for
 * an investigation. Keyless on the free, non-commercial tier, which allows 600
 * calls a minute, 5,000 an hour and 10,000 a day per IP; Vercel shares IPs, so we
 * budget far below that and cache per grid point and window. Data is CC BY 4.0:
 * show OPEN_METEO_ATTRIBUTION wherever it is displayed.
 * Checked 7 Nov 2026: https://open-meteo.com/en/docs and https://open-meteo.com/en/terms
 *
 * `getWeatherContext` never throws for an upstream problem: it returns
 * `sourceState: "unavailable"` with a safe message. Invalid input throws.
 * `createOpenMeteoSourceAdapter` wraps it in the shared SourceAdapter port,
 * which never throws at all.
 */
const NAME = "Open-Meteo";
const BASE_URL = "https://api.open-meteo.com/v1";
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** The forecast host serves about 92 days back and 15 days ahead. */
const MAX_DAYS_BACK = 90;
const MAX_DAYS_AHEAD = 14;

export type OpenMeteoClientOptions = Pick<ApiClientOptions, "fetch" | "sleep" | "timeoutMs"> & {
  now?: () => Date;
  /** Defaults to 15 minutes: models update hourly at best. */
  cacheTtlMs?: number;
  maxCacheEntries?: number;
};

type QueryInput = Omit<WeatherQuery, "hoursBefore" | "hoursAfter"> & { hoursBefore?: number; hoursAfter?: number };

export type OpenMeteoClient = {
  getWeatherContext(query: QueryInput, options?: { signal?: AbortSignal }): Promise<WeatherContext>;
};

/** Open-Meteo's start_hour/end_hour format, in GMT: yyyy-mm-ddThh:mm. */
const hourParam = (ms: number) => new Date(ms).toISOString().slice(0, 16);

export function normalizeWeatherQuery(input: QueryInput, now: Date): WeatherQuery {
  // 24 hours back so the shared contract's 24-hour rain total can be computed.
  const parsed = weatherQuerySchema.safeParse({ hoursBefore: 24, hoursAfter: 6, ...input });
  if (!parsed.success) {
    throw new IntegrationError(NAME, "bad_request", `${NAME}: invalid query at ${parsed.error.issues[0]?.path.join(".")}`);
  }
  const at = Date.parse(parsed.data.timeOfInterest);
  if (!Number.isFinite(at)) throw new IntegrationError(NAME, "bad_request", `${NAME}: timeOfInterest must be ISO 8601`);
  if (at < now.getTime() - MAX_DAYS_BACK * DAY_MS || at > now.getTime() + MAX_DAYS_AHEAD * DAY_MS) {
    throw new IntegrationError(NAME, "bad_request", `${NAME}: timeOfInterest must be within ${MAX_DAYS_BACK} days back and ${MAX_DAYS_AHEAD} ahead`);
  }
  // About 1 km: enough for weather, and Open-Meteo's logs never get the exact point.
  return {
    ...parsed.data,
    latitude: roundCoordinate(parsed.data.latitude),
    longitude: roundCoordinate(parsed.data.longitude),
    timeOfInterest: new Date(at).toISOString(),
  };
}

export function createOpenMeteoClient(config: OpenMeteoClientOptions = {}): OpenMeteoClient {
  const now = config.now ?? (() => new Date());
  const ttl = config.cacheTtlMs ?? 15 * 60_000;
  const maxEntries = config.maxCacheEntries ?? 200;
  const cache = new Map<string, { at: number; context: WeatherContext }>();
  const api = createApiClient({
    integration: NAME,
    baseUrl: BASE_URL,
    timeoutMs: config.timeoutMs ?? 10_000,
    rateLimits: [
      { limit: 60, windowMs: 60_000 },
      { limit: 1_000, windowMs: DAY_MS },
    ],
    maxConcurrent: 4,
    fetch: config.fetch,
    sleep: config.sleep,
  });

  async function fetchContext(query: WeatherQuery, signal?: AbortSignal): Promise<WeatherContext> {
    const retrievedAt = now().toISOString();
    const hour = Math.floor(Date.parse(query.timeOfInterest) / HOUR_MS) * HOUR_MS;
    const base = {
      source: "weather" as const,
      query,
      retrievedAt,
      fromCache: false,
      limitations: [...WEATHER_LIMITATIONS],
      provenance: openMeteoProvenance(false),
    };
    try {
      const response = await api.request({
        path: "/forecast",
        query: {
          latitude: query.latitude,
          longitude: query.longitude,
          current: OPEN_METEO_VARIABLES.join(","),
          hourly: OPEN_METEO_VARIABLES.join(","),
          // Inclusive window around the time of interest, in GMT.
          start_hour: hourParam(hour - query.hoursBefore * HOUR_MS),
          end_hour: hourParam(hour + query.hoursAfter * HOUR_MS),
          timezone: "GMT",
          // Integer UTC seconds: ISO strings come without an offset.
          timeformat: "unixtime",
          temperature_unit: "celsius",
          wind_speed_unit: "kmh",
          precipitation_unit: "mm",
        },
        schema: openMeteoResponseSchema,
        signal,
      });
      return { ...base, ...normalizeOpenMeteo(response, { query, retrievedAt }) };
    } catch (error) {
      if (!isIntegrationError(error)) throw error;
      return unavailableContext(query, retrievedAt, { kind: error.kind, message: error.userMessage });
    }
  }

  return {
    async getWeatherContext(input, options = {}) {
      const query = normalizeWeatherQuery(input, now());
      const key = JSON.stringify(query);
      const hit = cache.get(key);
      if (hit && now().getTime() - hit.at < ttl) {
        cache.delete(key);
        cache.set(key, hit);
        // A copy, so a caller changing it can't change what the next caller gets.
        return { ...structuredClone(hit.context), fromCache: true };
      }
      const context = await fetchContext(query, options.signal);
      if (context.sourceState !== "unavailable") {
        cache.set(key, { at: now().getTime(), context: structuredClone(context) });
        while (cache.size > maxEntries) cache.delete(cache.keys().next().value as string);
      }
      return context;
    },
  };
}

function unavailableContext(query: WeatherQuery, retrievedAt: string, error: { kind: string; message: string }): WeatherContext {
  return {
    source: "weather",
    query,
    sourceState: "unavailable",
    retrievedAt,
    fromCache: false,
    gridCell: null,
    current: null,
    readings: [],
    nearest: null,
    limitations: [...WEATHER_LIMITATIONS],
    provenance: openMeteoProvenance(false),
    error,
  };
}

let shared: OpenMeteoClient | undefined;

/** One client per server instance, so the rate limit and cache are shared. */
export function getOpenMeteo(): OpenMeteoClient {
  shared ??= createOpenMeteoClient();
  return shared;
}

/**
 * The shared SourceAdapter port for Open-Meteo: canonical observations plus
 * availability for one investigation. Never throws; a bad subject (for example
 * a time more than 90 days ago) becomes an "unavailable" observation.
 */
export function createOpenMeteoSourceAdapter(client: OpenMeteoClient = getOpenMeteo()): SourceAdapter {
  return async ({ investigationId, subject, checkedAt, signal }) => {
    const input = { latitude: subject.location.latitude, longitude: subject.location.longitude, timeOfInterest: subject.observedAt };
    try {
      return weatherObservations(await client.getWeatherContext(input, { signal }), { investigationId });
    } catch {
      const query = {
        latitude: roundCoordinate(input.latitude),
        longitude: roundCoordinate(input.longitude),
        timeOfInterest: input.timeOfInterest,
        hoursBefore: 24,
        hoursAfter: 6,
      };
      const context = unavailableContext(query, checkedAt, { kind: "bad_request", message: "Open-Meteo could not answer for that place and time." });
      return weatherObservations(context, { investigationId });
    }
  };
}

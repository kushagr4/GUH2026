import "server-only";
import { z } from "zod";
import { readIntegrationEnv, type EnvSource } from "@/lib/integrations/env";
import { createApiClient, type ApiClient } from "@/lib/integrations/http";
import { formatBbox } from "./bbox";
import { FIRMS_SOURCES, type Bbox, type FirmsSource } from "./types";

/**
 * NASA FIRMS area API (https://firms.modaps.eosdis.nasa.gov/api/area/), checked
 * 7 Nov 2026: GET /api/area/csv/[MAP_KEY]/[SOURCE]/[west,south,east,north]/[DAY_RANGE],
 * DAY_RANGE 1 to 5, and a limit of 5000 transactions per 10 minutes per key.
 *
 * The key is part of the URL path, so it lives in the client's baseUrl: the
 * shared HTTP client logs and labels requests by path, which then never
 * contains the key. It is also passed as a secret, so error text is scrubbed.
 */
export const FIRMS_NAME = "NASA FIRMS";
const FIRMS_BASE = "https://firms.modaps.eosdis.nasa.gov/api/area/csv";

export const FIRMS_ENV = {
  mapKey: {
    name: "NASA_FIRMS_MAP_KEY",
    pattern: /^[A-Za-z0-9]{16,64}$/,
    hint: "be the MAP_KEY from firms.modaps.eosdis.nasa.gov/api/map_key",
  },
  product: {
    name: "NASA_FIRMS_SOURCE",
    required: false,
    default: "VIIRS_SNPP_NRT",
    pattern: new RegExp(`^(${FIRMS_SOURCES.join("|")})$`),
    hint: `be one of ${FIRMS_SOURCES.join(", ")}`,
  },
} as const;

/**
 * EMBERGAP_FIRMS_MODE=live or demo decides. Unset, live NASA data is used as
 * soon as a NASA_FIRMS_MAP_KEY is configured, and labelled synthetic fixtures
 * only without one. Live mode never falls back to fixtures.
 */
export function getFirmsMode(env: EnvSource = process.env): "demo" | "live" {
  const mode = env.EMBERGAP_FIRMS_MODE?.trim().toLowerCase();
  if (mode === "live" || mode === "demo") return mode;
  return env.NASA_FIRMS_MAP_KEY?.trim() ? "live" : "demo";
}

export function readFirmsEnv(env: EnvSource = process.env) {
  return readIntegrationEnv(FIRMS_ENV, env);
}

export function createFirmsClient(mapKey: string, fetchImpl?: typeof fetch): ApiClient {
  return createApiClient({
    integration: FIRMS_NAME,
    baseUrl: `${FIRMS_BASE}/${encodeURIComponent(mapKey)}`,
    headers: { Accept: "text/csv, text/plain" },
    secrets: [mapKey, encodeURIComponent(mapKey)],
    timeoutMs: 12_000,
    retries: 1,
    // Far below FIRMS' own 5000 per 10 minutes. Results are also cached.
    rateLimits: [{ limit: 60, windowMs: 10 * 60_000 }],
    maxConcurrent: 2,
    fetch: fetchImpl,
  });
}

// One client per process, so its rate limit is shared by every request.
let shared: { mapKey: string; client: ApiClient } | null = null;

function sharedClient(mapKey: string): ApiClient {
  if (shared?.mapKey !== mapKey) shared = { mapKey, client: createFirmsClient(mapKey) };
  return shared.client;
}

export type FirmsCsvRequest = {
  mapKey: string;
  product: FirmsSource;
  bbox: Bbox;
  dayRange: number;
  signal?: AbortSignal;
  client?: ApiClient;
};

/** The raw CSV text. Parse it with parseFirmsCsv. */
export async function fetchFirmsCsv(request: FirmsCsvRequest): Promise<string> {
  const dayRange = Math.min(5, Math.max(1, Math.round(request.dayRange)));
  const client = request.client ?? sharedClient(request.mapKey);
  return client.request({
    path: `/${request.product}/${formatBbox(request.bbox)}/${dayRange}`,
    schema: z.string().max(5_000_000),
    acceptText: true,
    signal: request.signal,
  });
}

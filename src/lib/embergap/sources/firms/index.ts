import "server-only";
import {
  FIRMS_PROVENANCE,
  SOURCE_MAX_AGE_SECONDS,
  SYNTHETIC_NOW,
  classifyFreshness,
  type Bbox,
  type SourceAvailability,
} from "@/lib/embergap/contracts";
import type { EnvSource } from "@/lib/integrations/env";
import { isIntegrationError } from "@/lib/integrations/errors";
import { bboxContains, formatBbox } from "./bbox";
import { fetchFirmsCsv, FIRMS_NAME, getFirmsMode, readFirmsEnv, type FirmsCsvRequest } from "./client";
import { demoFirmsDetections } from "./fixtures";
import { FirmsFormatError, parseFirmsCsv } from "./parse";
import type { FirmsDetection, FirmsResult, FirmsSource } from "./types";

export type { FirmsDetection, FirmsResult } from "./types";
export { FIRMS_PROVENANCE };

const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 50;
const cache = new Map<string, { at: number; result: FirmsResult }>();

/** For tests. */
export function clearFirmsCache(): void {
  cache.clear();
}

export type ThermalAnomalyQuery = {
  /** The viewport. Live mode needs one. */
  bbox: Bbox | null;
  /** 1 to 5 days back. Defaults to 1. */
  dayRange?: number;
  now?: Date;
  env?: EnvSource;
  signal?: AbortSignal;
};

export type ThermalAnomalyDeps = {
  fetchCsv?: (request: FirmsCsvRequest) => Promise<string>;
};

function byNewest(a: FirmsDetection, b: FirmsDetection): number {
  return b.observedAt.localeCompare(a.observedAt);
}

/** Contract-shaped availability. "not_observed" always says which window found nothing. */
function availabilityFor(detections: FirmsDetection[], checkedAt: string, dayRange: number): SourceAvailability {
  const latestObservedAt = detections[0]?.observedAt ?? null;
  const maxAgeSeconds = SOURCE_MAX_AGE_SECONDS.firms;
  const state = classifyFreshness({ latestObservedAt, checkedAt, maxAgeSeconds });
  const windowStart = new Date(Date.parse(checkedAt) - dayRange * 24 * 3_600_000).toISOString();
  return {
    source: "firms",
    state,
    checkedAt,
    latestObservedAt,
    maxAgeSeconds,
    windowStart,
    windowEnd: checkedAt,
    message:
      state === "not_observed"
        ? "No thermal anomalies in this area in the window checked. That is unknown, not evidence of no fire."
        : null,
  };
}

function unavailable(checkedAt: string, product: FirmsSource, dayRange: number, message: string): FirmsResult {
  return {
    product,
    dayRange,
    detections: [],
    availability: {
      source: "firms",
      state: "unavailable",
      checkedAt,
      latestObservedAt: null,
      maxAgeSeconds: SOURCE_MAX_AGE_SECONDS.firms,
      windowStart: null,
      windowEnd: null,
      message,
    },
  };
}

/**
 * Thermal anomalies inside `bbox`. Demo mode (the default) returns labelled
 * synthetic fixtures, checked as of SYNTHETIC_NOW. Live mode queries FIRMS
 * server-side and reports failures as "unavailable": it never substitutes
 * fixtures for a failed query.
 */
export async function getThermalAnomalies(
  query: ThermalAnomalyQuery,
  deps: ThermalAnomalyDeps = {},
): Promise<FirmsResult> {
  const dayRange = Math.min(5, Math.max(1, Math.round(query.dayRange ?? 1)));
  const env = query.env ?? process.env;

  if (getFirmsMode(env) === "demo") {
    const since = Date.parse(SYNTHETIC_NOW) - dayRange * 24 * 3_600_000;
    const detections = demoFirmsDetections()
      .filter((detection) => bboxContains(query.bbox, detection.latitude, detection.longitude))
      .filter((detection) => Date.parse(detection.observedAt) >= since)
      .sort(byNewest);
    return {
      product: "VIIRS_SNPP_NRT",
      dayRange,
      detections,
      availability: availabilityFor(detections, SYNTHETIC_NOW, dayRange),
    };
  }

  const checkedAt = (query.now ?? new Date()).toISOString();
  const config = readFirmsEnv(env);
  if (config.state !== "ready") {
    return unavailable(checkedAt, "VIIRS_SNPP_NRT", dayRange, `${FIRMS_NAME} live mode is not set up on this server.`);
  }
  const product = config.values.product as FirmsSource;
  if (!query.bbox) {
    return unavailable(checkedAt, product, dayRange, "Zoom in to load live satellite detections.");
  }

  const cacheKey = `${product}|${formatBbox(query.bbox)}|${dayRange}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.parse(checkedAt) - hit.at < CACHE_TTL_MS) return hit.result;

  try {
    const csv = await (deps.fetchCsv ?? fetchFirmsCsv)({
      mapKey: config.values.mapKey,
      product,
      bbox: query.bbox,
      dayRange,
      signal: query.signal,
    });
    const detections = parseFirmsCsv(csv, { product, retrievedAt: checkedAt })
      .filter((detection) => bboxContains(query.bbox, detection.latitude, detection.longitude))
      .sort(byNewest);
    const result: FirmsResult = {
      product,
      dayRange,
      detections,
      availability: availabilityFor(detections, checkedAt, dayRange),
    };
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(cacheKey, { at: Date.parse(checkedAt), result });
    return result;
  } catch (error) {
    if (isIntegrationError(error)) return unavailable(checkedAt, product, dayRange, error.userMessage);
    if (error instanceof FirmsFormatError) {
      // Often an invalid or expired MAP_KEY, which FIRMS reports as plain text.
      console.warn(`[embergap] ${FIRMS_NAME} returned a non-CSV body (check NASA_FIRMS_MAP_KEY)`);
      return unavailable(checkedAt, product, dayRange, `${FIRMS_NAME} returned something unexpected.`);
    }
    throw error;
  }
}

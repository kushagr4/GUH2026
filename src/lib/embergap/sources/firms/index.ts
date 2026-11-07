import "server-only";
import type { EnvSource } from "@/lib/integrations/env";
import { isIntegrationError } from "@/lib/integrations/errors";
import { bboxContains, formatBbox } from "./bbox";
import { fetchFirmsCsv, FIRMS_NAME, getFirmsMode, readFirmsEnv, type FirmsCsvRequest } from "./client";
import { demoFirmsDetections } from "./fixtures";
import { FirmsFormatError, parseFirmsCsv } from "./parse";
import {
  FIRMS_LIMITATIONS,
  type Bbox,
  type FirmsDetection,
  type FirmsResult,
  type FirmsSource,
} from "./types";

export { parseBbox, bboxContains } from "./bbox";
export type { Bbox, DataMode, FirmsDetection, FirmsResult, SourceState } from "./types";

const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 50;
const cache = new Map<string, { at: number; result: FirmsResult }>();

/** For tests. */
export function clearFirmsCache(): void {
  cache.clear();
}

export type ThermalAnomalyQuery = {
  bbox: Bbox;
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

function demoResult(query: Required<Pick<ThermalAnomalyQuery, "bbox" | "dayRange" | "now">>): FirmsResult {
  const since = query.now.getTime() - query.dayRange * 24 * 60 * 60_000;
  const detections = demoFirmsDetections(query.now)
    .filter((detection) => bboxContains(query.bbox, detection.latitude, detection.longitude))
    .filter((detection) => Date.parse(detection.observedAt) >= since)
    .sort(byNewest);
  return {
    mode: "demo",
    sourceState: detections.length ? "available" : "not_observed",
    product: "VIIRS_SNPP_NRT",
    bbox: query.bbox,
    dayRange: query.dayRange,
    retrievedAt: query.now.toISOString(),
    detections,
    limitations: ["Synthetic demo data: these detections did not happen.", ...FIRMS_LIMITATIONS],
  };
}

function unavailable(
  query: Required<Pick<ThermalAnomalyQuery, "bbox" | "dayRange">>,
  product: FirmsSource,
  error: string,
): FirmsResult {
  return {
    mode: "live",
    sourceState: "unavailable",
    product,
    bbox: query.bbox,
    dayRange: query.dayRange,
    retrievedAt: null,
    detections: [],
    limitations: [...FIRMS_LIMITATIONS],
    error,
  };
}

/**
 * Thermal anomalies inside `bbox`. Demo mode (the default) returns labelled
 * synthetic fixtures. Live mode queries FIRMS server-side and reports failures
 * honestly as `unavailable`: it never substitutes fixtures for a failed query.
 */
export async function getThermalAnomalies(
  query: ThermalAnomalyQuery,
  deps: ThermalAnomalyDeps = {},
): Promise<FirmsResult> {
  const now = query.now ?? new Date();
  const dayRange = Math.min(5, Math.max(1, Math.round(query.dayRange ?? 1)));
  const env = query.env ?? process.env;

  if (getFirmsMode(env) === "demo") return demoResult({ bbox: query.bbox, dayRange, now });

  const config = readFirmsEnv(env);
  if (config.state !== "ready") {
    return unavailable(
      { bbox: query.bbox, dayRange },
      "VIIRS_SNPP_NRT",
      `${FIRMS_NAME} live mode is not set up on this server.`,
    );
  }
  const product = config.values.product as FirmsSource;
  const cacheKey = `${product}|${formatBbox(query.bbox)}|${dayRange}`;
  const hit = cache.get(cacheKey);
  if (hit && now.getTime() - hit.at < CACHE_TTL_MS) return hit.result;

  try {
    const csv = await (deps.fetchCsv ?? fetchFirmsCsv)({
      mapKey: config.values.mapKey,
      product,
      bbox: query.bbox,
      dayRange,
      signal: query.signal,
    });
    const retrievedAt = now.toISOString();
    const detections = parseFirmsCsv(csv, { product, retrievedAt })
      .filter((detection) => bboxContains(query.bbox, detection.latitude, detection.longitude))
      .sort(byNewest);
    const result: FirmsResult = {
      mode: "live",
      sourceState: detections.length ? "available" : "not_observed",
      product,
      bbox: query.bbox,
      dayRange,
      retrievedAt,
      detections,
      limitations: [...FIRMS_LIMITATIONS],
    };
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(cacheKey, { at: now.getTime(), result });
    return result;
  } catch (error) {
    if (isIntegrationError(error)) {
      return unavailable({ bbox: query.bbox, dayRange }, product, error.userMessage);
    }
    if (error instanceof FirmsFormatError) {
      // Often an invalid or expired MAP_KEY, which FIRMS reports as plain text.
      console.warn(`[embergap] ${FIRMS_NAME} returned a non-CSV body (check NASA_FIRMS_MAP_KEY)`);
      return unavailable({ bbox: query.bbox, dayRange }, product, `${FIRMS_NAME} returned something unexpected.`);
    }
    throw error;
  }
}

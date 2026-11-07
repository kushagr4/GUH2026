import "server-only";
import type { EnvSource } from "@/lib/integrations/env";
import { bboxContains } from "@/lib/embergap/sources/firms/bbox";
import { getThermalAnomalies, type ThermalAnomalyDeps } from "@/lib/embergap/sources/firms";
import { demoInvestigations } from "./demo-investigations";
import { ageMinutes, approximateLocation, freshnessOf } from "./geo";
import type { Bbox, MapFeature, MapResponse } from "./types";

export const MAP_LIMIT = { default: 50, max: 200 } as const;

export type LimitParseResult = { ok: true; limit: number } | { ok: false; error: string };

export function parseLimit(raw: string | null | undefined): LimitParseResult {
  if (raw === null || raw === undefined || raw === "") return { ok: true, limit: MAP_LIMIT.default };
  if (!/^\d{1,4}$/.test(raw)) return { ok: false, error: "limit must be a whole number" };
  const limit = Number(raw);
  if (limit < 1 || limit > MAP_LIMIT.max) {
    return { ok: false, error: `limit must be between 1 and ${MAP_LIMIT.max}` };
  }
  return { ok: true, limit };
}

export type MapQuery = {
  bbox: Bbox;
  limit: number;
  now?: Date;
  env?: EnvSource;
  signal?: AbortSignal;
};

/**
 * The public-safe map projection: thermal anomalies plus investigations, each
 * with an approximate location, freshness, review status and provenance. No
 * report text, photos, reporter identity or exact report coordinates.
 *
 * Investigations come from synthetic demo fixtures until Claude Mac's
 * repository interface lands; then this reads through it, under RLS.
 */
export async function getMapData(query: MapQuery, deps: ThermalAnomalyDeps = {}): Promise<MapResponse> {
  const now = query.now ?? new Date();
  const firms = await getThermalAnomalies(
    { bbox: query.bbox, now, env: query.env, signal: query.signal },
    deps,
  );

  const anomalies: MapFeature[] = firms.detections.map((detection) => {
    const age = ageMinutes(detection.observedAt, now);
    return {
      id: detection.id,
      kind: "thermal_anomaly",
      title: `Thermal anomaly (${detection.instrument ?? detection.product})`,
      latitude: detection.latitude,
      longitude: detection.longitude,
      locationPrecisionKm: detection.instrument === "MODIS" ? 1 : 0.4,
      observedAt: detection.observedAt,
      ageMinutes: age,
      freshness: freshnessOf(age),
      reviewStatus: null,
      priority: null,
      provenance: {
        source: "firms",
        mode: firms.mode,
        label: detection.synthetic
          ? "Synthetic FIRMS-style detection (demo)"
          : `NASA FIRMS ${detection.product}`,
      },
      investigationId: null,
      confidence: detection.confidence,
      frpMw: detection.frpMw,
    };
  });

  const investigations: MapFeature[] = demoInvestigations(now)
    .filter((item) => bboxContains(query.bbox, item.report.latitude, item.report.longitude))
    .map((item) => {
      const location = approximateLocation(item.report.latitude, item.report.longitude);
      const age = ageMinutes(item.report.observedAt, now);
      return {
        id: `investigation:${item.id}`,
        kind: "investigation",
        title: item.title,
        latitude: location.latitude,
        longitude: location.longitude,
        locationPrecisionKm: location.precisionKm,
        observedAt: item.report.observedAt,
        ageMinutes: age,
        freshness: freshnessOf(age),
        reviewStatus: item.status,
        priority: item.recommendation.priority,
        provenance: { source: "reports", mode: item.mode, label: "Synthetic report (demo)" },
        investigationId: item.id,
        confidence: null,
        frpMw: null,
      };
    });

  // Investigations first (they are what reviewers act on), then newest anomalies.
  const all = [
    ...investigations.sort((a, b) => b.observedAt.localeCompare(a.observedAt)),
    ...anomalies,
  ];
  const features = all.slice(0, query.limit);

  return {
    generatedAt: now.toISOString(),
    bbox: query.bbox,
    limit: query.limit,
    total: all.length,
    truncated: all.length > features.length,
    features,
    sources: {
      firms: {
        mode: firms.mode,
        state: firms.sourceState,
        product: firms.product,
        dayRange: firms.dayRange,
        retrievedAt: firms.retrievedAt,
        note:
          firms.mode === "demo"
            ? "Synthetic thermal anomalies for the demo."
            : `Live NASA FIRMS ${firms.product}, last ${firms.dayRange * 24} hours.`,
        limitations: firms.limitations,
        ...(firms.error ? { error: firms.error } : {}),
      },
      investigations: {
        mode: "demo",
        state: investigations.length ? "available" : "not_observed",
        retrievedAt: now.toISOString(),
        note: "Synthetic reports and investigations. Report locations are shown to about 2 km.",
        limitations: ["Reports are unverified claims. No report on the map is a confirmed fire."],
      },
    },
  };
}

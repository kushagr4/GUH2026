import "server-only";
import {
  FIRMS_PROVENANCE,
  SOURCE_MAX_AGE_SECONDS,
  classifyFreshness,
  mapModeFor,
  type InvestigationReadRepository,
  type MapFeature,
  type MapQuery,
  type MapResponse,
} from "@/lib/embergap/contracts";
import type { EnvSource } from "@/lib/integrations/env";
import { getThermalAnomalies, type ThermalAnomalyDeps } from "@/lib/embergap/sources/firms";
import { bboxContains } from "@/lib/embergap/sources/firms/bbox";
import { getFirmsMode } from "@/lib/embergap/sources/firms/client";
import { relocateLegacyDetections } from "./demo-detections";
import type { FirmsDetection } from "@/lib/embergap/sources/firms/types";

export type MapDeps = ThermalAnomalyDeps & {
  repository: InvestigationReadRepository;
  env?: EnvSource;
  now?: Date;
  signal?: AbortSignal;
};

export class MapReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MapReadError";
  }
}

function anomalyFeature(detection: FirmsDetection, checkedAt: string): MapFeature {
  // FIRMS pixels are public data: they keep their own ~375 m to 1 km precision.
  const pixelKm = Math.max(detection.evidence.scanKm ?? 0.375, detection.evidence.trackKm ?? 0.375);
  return {
    id: detection.id,
    kind: "thermal_anomaly",
    location: {
      latitude: detection.latitude,
      longitude: detection.longitude,
      precisionMeters: Math.max(1, Math.round((pixelKm * 1000) / 2)),
    },
    investigationId: null,
    status: null,
    reviewOutcome: null,
    reviewPriority: null,
    observedAt: detection.observedAt,
    freshness: classifyFreshness({
      latestObservedAt: detection.observedAt,
      checkedAt,
      maxAgeSeconds: SOURCE_MAX_AGE_SECONDS.firms,
    }),
    sources: ["firms"],
    provenance: { ...FIRMS_PROVENANCE, product: detection.product, isSynthetic: detection.isSynthetic },
    firms: detection.evidence,
    investigation: null,
  };
}

/**
 * The public-safe map projection: investigations from the read repository
 * (public grid locations, no reporter, text or photo) plus FIRMS thermal
 * anomalies. Investigations come first, then the newest anomalies, up to limit.
 */
export async function getMapData(query: MapQuery, deps: MapDeps): Promise<MapResponse> {
  // Demo fixtures are placed next to the synthetic scenarios (in Italy) before the viewport filter.
  const demo = getFirmsMode(deps.env ?? process.env) === "demo";
  const [investigations, raw] = await Promise.all([
    deps.repository.listMapInvestigations(query),
    getThermalAnomalies({ bbox: demo ? null : query.bbox, now: deps.now, env: deps.env, signal: deps.signal }, deps),
  ]);
  const firms = demo
    ? {
        ...raw,
        detections: relocateLegacyDetections(raw.detections).filter((detection) =>
          bboxContains(query.bbox, detection.latitude, detection.longitude),
        ),
      }
    : raw;
  if (!investigations.ok) throw new MapReadError(investigations.error.message);

  const checkedAt = firms.availability.checkedAt;
  const anomalies = firms.detections.map((detection) => anomalyFeature(detection, checkedAt));
  const room = Math.max(0, query.limit - investigations.data.features.length);
  const features = [...investigations.data.features, ...anomalies.slice(0, room)];

  return {
    mode: mapModeFor(features),
    generatedAt: new Date().toISOString(),
    bbox: query.bbox,
    limit: query.limit,
    truncated: investigations.data.truncated || anomalies.length > room,
    features,
    sourceAvailability: [firms.availability],
  };
}

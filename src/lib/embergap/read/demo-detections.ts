import { SYNTHETIC_SCENARIOS, type SyntheticScenarioId } from "@/lib/embergap/contracts";
import type { FirmsDetection } from "@/lib/embergap/sources/firms/types";

/**
 * Italy move (Claude Mac, read layer only). The shared synthetic scenarios now
 * sit in Italy, but the FIRMS demo fixtures (owned by the sources team) may
 * still be placed around the old UK locations. Until they move, each legacy
 * detection is shifted by the same offset as its scenario, so markers, details
 * and observations agree geographically. Ids, times and evidence are kept.
 * Once the fixtures are already near the Italian scenarios this is a no-op.
 * Only ever applied to SYNTHETIC detections; live FIRMS data is never moved.
 */
const LEGACY_ANCHORS: Record<SyntheticScenarioId, { latitude: number; longitude: number }> = {
  "corroborated-smoke": { latitude: 53.546, longitude: -1.982 },
  "misleading-photo": { latitude: 53.625, longitude: -2.521 },
  "missing-satellite-pass": { latitude: 53.384, longitude: -1.872 },
  "weather-timeout": { latitude: 53.602, longitude: -1.931 },
  "repeated-witness": { latitude: 53.913, longitude: -1.832 },
  "partition-recovery": { latitude: 53.462, longitude: -1.853 },
};

/** The old demo area: the South Pennines. Nothing real is placed here by the demo any more. */
const isLegacy = (detection: { latitude: number; longitude: number }) =>
  detection.latitude > 53 && detection.latitude < 54.2 && detection.longitude > -3 && detection.longitude < -1.3;

export function relocateLegacyDetection(detection: FirmsDetection): FirmsDetection {
  if (!detection.isSynthetic || !isLegacy(detection)) return detection;
  let best: { id: SyntheticScenarioId; distance: number } | null = null;
  for (const [id, anchor] of Object.entries(LEGACY_ANCHORS) as [SyntheticScenarioId, { latitude: number; longitude: number }][]) {
    const distance = Math.hypot(anchor.latitude - detection.latitude, anchor.longitude - detection.longitude);
    if (!best || distance < best.distance) best = { id, distance };
  }
  const scenario = SYNTHETIC_SCENARIOS.find((entry) => entry.id === best!.id)!;
  const anchor = LEGACY_ANCHORS[best!.id];
  const round = (value: number) => Math.round(value * 10_000) / 10_000;
  return {
    ...detection,
    latitude: round(scenario.report.latitude + (detection.latitude - anchor.latitude)),
    longitude: round(scenario.report.longitude + (detection.longitude - anchor.longitude)),
  };
}

export function relocateLegacyDetections(detections: readonly FirmsDetection[]): FirmsDetection[] {
  return detections.map(relocateLegacyDetection);
}
